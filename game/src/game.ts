// Game orchestration: state machine (title/playing/paused/inventory/dead/won), the frame loop,
// combat resolution, zombie updates, pickups and the station lifecycle (new seed per run).

import * as THREE from 'three';
import {freshSeed, mulberry32, seedToCode} from './core/rng';
import {PropIndex, moveCircle} from './core/physics';
import {CELL, PathFinder, nearestWalkable} from './gen/grid';
import {BODY_CLEAR, levelsOf, type Levels} from './gen/levels';
import type {StationLayout} from './gen/station';
import {PropModelLibrary, loadAssets, type AssetBundle} from './assets/loader';
import {foreignTo, levelWorkingSet, selectLevelKeys} from './assets/levelAssets'; // Task track3-eaton-centre-20261031 (lane PACKAGE): level-scoped lazy assets
import {adoptStationName} from './campaign/stationName';
import {LevelResources} from './assets/levelResources'; // lane PACKAGE (track3): level textures / GPU resources released with their level
import {P7_FILES, dropUnloadedP7, p7ModelKeysFor} from './gen/props07';
import {buildWorldSteps, type BuiltWorld} from './world/builder';
import {fogCullDistance} from './world/levelCulling';
import {WorldMaterials} from './world/materials';
import {MOOD, StationLighting} from './world/lights';
import {VolumetricAtmosphere} from './render/volumetric';
import {PickupManager, makeSupplyMesh, refreshItemTemplates, registerItemModels, type Pickup} from './world/pickups';
import {levelPreloadPantryIds, pantryHolderRealizer, pantryIdsIn, pantryPickupItem} from './items/pantryVariety'; // task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): food variety
import {ensurePantryModels} from './world/pantryModels'; // (lane ITEMS) the pantry items' lazy models
import {WEAPON_POOL_LANE, plannedVarietyIds, sectionWeaponPool, varietyIdsIn, weaponFindPlan} from './items/weaponVariety'; // task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): weapon find identities
import {WEAPON_VARIETY_WARM_GROUP, ensureWeaponVarietyModels, weaponVarietyWarmRoots} from './world/weaponVarietyModels'; // (lane LOOT-UI) the new weapons' lazy models
import {installWeaponVarietyDelivery, type WeaponVarietyDelivery} from './world/weaponVarietyDelivery'; // task studio-weapon-runtime-fix-20261110-022206-01: one delivery of a lazily loaded weapon model to the held view / pickups / icons
import {Survival, survivalTicks} from './player/survival';
import {ContainerManager, type ContainerEvent, type ContainerTarget} from './world/containers';
import {SoundGate} from './world/openables';
import {Effects} from './world/fx';
import {Input} from './player/input';
import {Player, WALK_SPEED, stanceRecoilMult, stanceSpreadMult} from './player/player';
import {Inventory, MELEE_REF, THROW_REF, isMeleeItem, type ItemStack, type SlotRef} from './items/inventory';
import {ITEMS, itemDef, throwHint, useHint, useLabel} from './items/items';
import {WEAPONS, WeaponController, caliberLabel, reserveFor, type WeaponDef} from './weapons/weapons';
import {baseSpread, bloomDecay, reloadCueTime, shotBloom, shotRecoil} from './weapons/gunHandling'; // task studio-weapon-variety-production-20261109-224355-01 (lane GUNS)
import {CALIBERS, ammoText} from './items/calibers'; // lane AMMO: caliber-based ammo
import {Viewmodel} from './weapons/viewmodel';
import {devPistolRequested, makePistolDevPlaceholder, PISTOL_ART_READY, startWeaponFor, type StartWeapon} from './weapons/pistol';
import {ConsumeView} from './weapons/consumeView';
import {buildItemIcons, onItemIconsChanged, refreshItemIcons} from './ui/itemIcons';
import {ZombieActor} from './ai/zombieActor';
import {StrainerWetTrail} from './ai/strainerTrail';
import {createEnemyActor, enemyCues, type EnemyActor} from './ai/creatureArchetypes'; // iteration 07 (Lane Q): generic enemy archetypes (rat/dog)
import {VocalReach} from './ai/vocalReach'; // Task office-overhaul-20261030 (lane AUDIO): enemy vocals by navigable route
import {FrameBudget} from './core/frameBudget'; // Task frame-budget-deferral-20261030 (lane SCHED): deferred background work
import {PacedBuildCancelled, drainSync, newPacedStats, runPaced, type BuildSteps, type PacedBuildOptions, type PacedBuildStats} from './core/pacedBuild'; // task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): the journey's paced station build
import {PathService, nearPlayerRule, PATH_DEFER} from './ai/pathService'; // lane SCHED: far, not-in-sight chase re-plans through the frame budget
import {HordeDirector} from './ai/horde'; // Task track3-eaton-centre-20261031 (lane HORDE): roaming hordes (layout.hordes)
import {ChaseShare, atriumNearRule, atriumPathOptions, searchExpand} from './ai/chaseShare'; // lane HORDE (atrium AI): open-atrium chase relief (layout.mall only)
import {spawnProfile} from './ai/spawnTables'; // lane HORDE: the level's horde patrol rules
import {HOOK_SLOTS, S as SPAN, UpdateProfiler} from './debug/updateProfile'; // Task frame-budget-deferral-20261030 (lane MEASURE): opt-in frame profiler
import type {ZombieSpawn} from './gen/station';
import {ZombieLookLibrary} from './ai/outfits';
import {chooseSpawnLook, cosplayModelKeysFor, lingerieModelKeysFor} from './ai/spawnLook'; // task mall-lingerie-20261102-221554 (lane CONTEXT): ordinary pick, or the lingerie store's variants' set
import {homeWorld, wanderHomesFor, type WanderHome} from './ai/wanderHome'; // task gameplay-feedback-20261111 (lane SPAWNS): zone-local wander homes
import {LINGERIE_MODEL_FILES, createLingerieLibrary} from './ai/lingerie'; // (lane FIT's lazy garments + their separate look library)
import {COSPLAY_MODEL_FILES, createCosplayLibrary} from './ai/cosplay'; // task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the convention's lazy costumes + their separate look library
import type {WardrobeLibrary} from './ai/wardrobe';
import {alertListeners, type BrainWorld} from './ai/brain';
import {lureWorld} from './ai/lightLure'; // Iteration 12 (AI): light attracts enemies
import {ScentLures} from './ai/scentLure'; // task studio-refinement-batch-20261113-035659-01 (lane LURE): the lure grenade's scent
import {moveZombie, sameLevel, settleZombie} from './ai/motor';
import {ladderTarget, type Ladder} from './gen/traversal';
import {raycastWorld, type Vec3, type WorldHit} from './combat/hitscan';
import {raycastShot} from './physics/merchOnHost'; // task studio-skywalk-variety-20261107-231448-01 (lane MERCH): bullets into open shelves
import {nearestEnemyHit} from './combat/enemyRay'; // lane COMBAT (reactor-playtest-round2): cross-storey bullet / pellet hits
import {meleeRayDirs, resolveMelee, resolveMeleeSweep, asMeleeSweep} from './combat/melee'; // lane KNIFE (knife-melee-20261030)
// task studio-weapon-variety-production-20261109-224355-01 (lane MELEE): heavy melee hits — charge / stamina / per-target damage, mass knockback, stagger
import {MeleeShoves, meleeHint, meleeHitDamage, meleeKillStrength, meleeKnockFor, meleePushDir, meleeShoveStep, meleeStaggerOpts, meleeStaminaCost, meleeSwing} from './combat/meleeImpact';
import {DAMAGE_MATERIALS, propDamageSpec} from './damage/materials'; // lane KNIFE: blade-on-surface cue / chips
import {Hud} from './ui/hud';
import {InventoryUI} from './ui/inventoryUI';
import {hideTooltip} from './ui/tooltip'; // task studio-ui-subway-maps-20261108-074144-01 (the game's own tooltip)
import {Sfx, ambienceTypeFor, humEmitters, roomKindFor} from './audio/sfx';
import {fanSources} from './audio/fanSound';
import {ANNEX_GENSET, gensetModelKeysFor} from './assets/annexGenset';
import {PhysicsSystem, killImpulseStrength, type PhysicsAudio} from './physics/world';
import {DamageSystem} from './damage/system';
import {ShelfStock, SHELF_JUNK_KEY, SHELF_JUNK_MODEL_FILES, shelfJunkModelKeysFor} from './world/shelfStock'; // (+ task studio-food-shelf-production-20261109-002816-01: the Meshy shelf-junk atlas)
import {prepareStockMovingSets, stockMovingSets} from './world/shelfStockWarm'; // task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): the filler's moving sets before the warm-up
import {LightSources} from './world/lightSources';
import {PlayerLight, applyBatteryItem} from './player/flashlight'; // Iteration 12 (LIGHT): flashlight battery + body glow
import {FlareSystem, throwOneFlare, type FlareSmokeHost} from './weapons/throwables'; // Iteration 12 (LIGHT): thrown road flares (grenade slot)
import {FlareHold} from './weapons/flareHold'; // Iteration 15: hold to ready, release to throw
import {GrenadeSystem, throwHoldTarget, throwOneGrenade} from './weapons/grenades'; // task studio-refinement-batch-20261113-035659-01: the crafted acid / lure grenades
import {BASE_MODIFIERS, combineModifiers, type ModifierSource, type PlayerModifiers} from './player/modifiers'; // Iteration 16 (shared contract)
import {incomingHit, meleeHitLocation, type PlayerHit, type ResolvedHit} from './player/hits'; // Iteration 16 (shared contract)
import {armorHit, armorPool} from './player/armor'; // task studio-general-armor-20261107-231448-01: the worn armour pool
import {biteHitLocation, installInjuries, injuryStatusHtml, type InjurySystem} from './player/injuries'; // Iteration 16 (lane INJURY)
import {installGear, type GearSystem} from './gear/system'; // Iteration 16 (lane GEAR): gear slots, deployable backpack, grounded bags
import {installFuelStations, type FuelStations} from './world/fuelStations'; // task train-fuel-system: the stations' finite fuel (plans realized once; map figures)
import {FUEL, applyDebit, planDebit, refundDebit, reservesOf, routeCost, tanksText, type CartFuel, type FuelDebit} from './fuel/fuel'; // task train-fuel-system
import type {FuelCartsLike} from './fuel/trainPort'; // task train-fuel-system: the carts aboard as the departure sees them (world/fuelCarts.ts)
import {installGasMask, type GasMaskSystem} from './gear/gasMask'; // Task gasmask-breach-20261030 (mask lane): gas mask on / off (Q), filters (+ the first-person mask view, gear/maskView.ts)
import {installFuelPort, type FuelPortSystem} from './world/fuelPort'; // task train-fuel-system (lane PORT): the train's fuel cap (pour a fuel can), HUD fuel readout
import {preloadFuelCanModel} from './world/fuelCanModel'; // task train-fuel-system (lane PORT): the delivered fuel-can GLB
import {preloadGrenadeModels} from './world/grenadeModels'; // task studio-refinement-batch-20261113-035659-01: the crafted acid / lure grenades
import {ACID_GRENADE, isGrenadeItem, type GrenadeId} from './items/grenades';
import {installFuelCarts, type FuelCarts} from './world/fuelCarts'; // task train-fuel-system (lane CART): fuel carts — push / grab, hose to the fuel cap, station / train cargo ownership
import {installSkywaysCar, type SkywaysCar} from './world/skywaysCar'; // task skyways-level-20261106 (lane CAR): the Skyways prize car (first-person drivable)
import {MaskView} from './gear/maskView'; // Task gas-mask-roof-feedback-20261030 (item 4): first-person view through the real mask's visor
import {installStalls, type StallSystem} from './world/stalls'; // Task office-overhaul-20261030 (lane INTERACT, #13): stall doors, walk-in collision, toilet loot
import {installTower, type TowerRuntime} from './world/towerRuntime'; // Iteration 16 (lane TOWER): elevator, stair doors, windows, exterior
import {installSkywaysWindows, type SkywaysWindowRuntime} from './world/skywaysWindows'; // task studio-skyways-level-20261106-054448 (lane GAS): the Skyways glazing
import {installSkywaysExterior} from './world/skywaysExterior'; // task studio-skyways-level-20261106-054448 (lane VIEW): the city outside the Skyways glass
import {skywalkText} from './gen/skyways/skywalkText'; // task studio-skywalk-variety-20261107-231448-01: player-facing Skyways wording
import {installOfficeAtmosphere} from './world/officeAtmosphere'; // Task office-overhaul-20261030 (lane ARCH): office textures, roof outdoor fog
import {installMallAtmosphere} from './world/mallAtmosphere'; // Task track3-eaton-centre-20261031 (lane ARCH): the mall's light haze / far plane
import {installReactorArch} from './world/reactor/archInstall'; // task reactor-build-20261101 (lane ARCH): Reactor surface sets, deep haze / far plane, kit visuals tick
import {installReactorCoreLights} from './world/reactor/coreLights'; // task reactor-expansion-20261101 (lane CORE)
import {REACTOR_MODEL_FILES} from './world/reactor/archAssets'; // task reactor-build-20261101 (lane ARCH): the lead's Reactor GLB kit (level-only)
import {WASTE_MODEL_FILES} from './world/reactor/wasteAssets'; // task reactor-expansion-20261101 (lane WASTE): the waste set of REACTOR_X_KIT (level-only)
import {attributeInstancing, setAttributeInstancing} from './render/instancing'; // Task track3-eaton-centre-20261031 (lane PERF): shared instancing programs in the mall
import {collectTextures, modelTextures, releaseModelTexturesAfterUpload, stageUploads, textureReleaseStats, trackUploads} from './assets/textureRelease'; // (lane PERF) mall: decoded images freed after upload, uploads staged
import {installGas, type GasSystem} from './world/gas/system'; // Task gasmask-breach-20261030 (lane GAS): breakable office windows, breach gas, exposure
import {bunkerGasSource} from './world/gas/zones'; // task studio-bunker-level-20261109-072224-01: the Bunker's local gas leaks (a gas zone world)
import {BUNKER_KIT_MODEL_FILES, bunkerModelKindKeysFor} from './gen/bunker/bunkerKinds'; // (follow-up) the Bunker's model-backed flavour kinds (lazy)
import {CORPSE_DEN_MODEL_FILES, corpseDenModelKeysFor} from './gen/market/v4/denKinds'; // task studio-corpse-market-shop-20261114-031614-01: the Market den's chute / booth (lazy, level-only market-*)
import {installCough, type CoughFeedback} from './audio/cough'; // Task gas-mask-roof-feedback-20261030: the player coughs while gas hurts them
import {installReactorAir} from './world/reactor/generators'; // task reactor-build-20261101 (lane AIR): Reactor depth gas + auxiliary generators
import {installBlightBurst, type BlightBurstSystem, type BlightEnemy} from './ai/blightBurst'; // Task track1-siren-blightbelly-20261031 (lane BLIGHT): the Blightbelly's once-only death burst
import {ENEMY_MODEL_FILES, enemyModelKeysFor, withEnemyModels} from './ai/enemyModels'; // Task track1-siren-blightbelly-20261031 (lane BLIGHT): level-specific (lazy) enemy models
import {installSirens, type SirenSystem} from './ai/sirenSystem'; // Task track1-siren-blightbelly-20261031 (lane SIREN): Siren lifecycle / persistence / veins
import {preloadMedicalModels} from './world/medicalItems'; // Iteration 16 (lane INJURY): Meshy A7 / A8 treatment models
import {installReactorRestart, preloadReactorItemModels} from './world/reactor/restart';
import {installReactorStartup} from './world/reactor/startup'; // task reactor-playtest-round2-20261102 (lane STARTUP): startup audio, orange beacons, the ONLINE sky
import {installReactorEnding} from './world/reactor/ending'; // task studio-reactor-surface-ending-20261102 (lane ENDING): the exterior door -> surface
import {installReactorSurface} from './world/reactor/surface'; // task studio-reactor-surface-ending-20261102 (lane SURFACE): the city / rain / clear air outside
import {installReactorCredits, reactorCreditsOf} from './world/reactor/credits'; // task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CREDITS): the end credits
import {installReactorCpuCulling} from './world/reactor/cpuActorCulling'; // task studio-reactor-submit-roof-fog-20261102 (lane CPU)
import {installBunkerObjective} from './world/bunker/objective'; // task studio-bunker-level-20261109-072224-01 (lane OBJECTIVE): the Bunker's optional generators + core intel
import {installReactorMapBoards} from './world/reactor/mapBoard'; // task reactor-expansion-20261101 (lane CONTROLS) // task reactor-build-20261101 (lane RESTART): restart controls, screens, the win, the restart parts' models
import {archetypeOf} from './ai/creatureArchetypes'; // Iteration 16 (lane INJURY): rat / dog bites go low
import {SCREACHER_NOISE, ScreacherBrain, deliverNoise, echoLocate, landNoise, type ScreacherNoiseKind} from './ai/screacher'; // task studio-screacher-production-20261110-221858-01: the blind, sound-hunting family
import {BbBrain, bbShoveStep} from './ai/bb'; // task studio-bb-production-20261112-234540-01: BB, the small wall / ceiling crawler
import {levelsCrawlWorld, type CrawlWorld} from './ai/bbSurface';
import type {StationLayout as Iter16Layout} from './gen/stationTypes';
// Iteration 16 (lane RUN): logical levels / sections, travel, run carryover (levels/registry.ts, run/*)
import {LEVELS, LEVEL_IDS, arrivalPose, clearLabel, levelDisplayName, sectionLabel, storeyLabel} from './levels/registry';
import {rollLevelGear} from './levels/gearAdapter';
import {lootProfile} from './items/lootTables'; // Task loot-tables-20261030 (lane LOOT)
import {sectionId, type Arrival, type LevelId, type SectionGenContext, type SectionKey, type TravelRequest} from './levels/types';
import type {CampaignState} from './campaign/types'; // Task studio-alpha-campaign-foundation-20261102-230708-01 (primary)
import {archetypeLabel, generateNetwork, validateNetwork} from './campaign/network';
import {arrive as arriveCampaign, enableCheat, newCampaign, revealAround, transitOf, travelPlan, upgradeCampaign} from './campaign/discovery';
import {PaperMap, type MapFuel} from './ui/paperMap';
import {createRun, type RunState} from './run/runState';
import {enemiesToSpawn, mergeKilled, pickupPlan} from './run/memory';
import {resetParticipants, restoreCarry, restoreParticipants, takeSnapshot, type RunParticipant, type RunSnapshot} from './run/snapshot';
import {starterInventory} from './run/starter';
import {applyHolders, captureHolders, capturePickups, dropNaturalFood, dropUnrecordedSalvage, holderKeyOf, restorePickup} from './run/worldMemory';
import {keepLayoutPickup} from './items/naturalFood'; // task studio-food-drink-half-20261109-201124-01: half the natural food / drink spawn
import {runBagStore} from './run/bagStore';
import {playerTrainPlacement, type TrainPlacement} from './gen/playerTrain'; // task player-train-shell-20261101-202805 (lane PLACE)
import {PlayerTrainRecord, PLAYER_TRAIN_PARTICIPANT} from './run/playerTrain'; // (lane PLACE: the run's one train identity)
// --- save / load (lane SAVE) imports: task studio-alpha-campaign-foundation-20261102-230708-01 ---
import {SaveSlots, type CommitResult} from './save/slots';
import {captureRun, clampTrainLocal, deriveMeta, installRestore, makeSaveFile, prepareRestore, type PreparedRestore, type RestoreHandoff, type SaveFileV1Like, type SavePoint, type TrainLocalPose} from './save/serialize';
import {validateSaveFile, type ValidateOptions} from './save/validate';
import {trainSpawnLocal, trainToWorld, worldToTrain} from './gen/playerTrain';
import {PLAYER_TRAIN_SPEC} from './world/playerTrainSpec';
// --- end save / load (lane SAVE) imports ---
import {PLAYER_TRAIN_MODEL_FILES, installPlayerTrain, loadTrainTextures, playerTrainModelKeys, trainModelsFrom, type PlayerTrainRuntime} from './world/playerTrain'; // (lane TRAIN: the car in the game)
import {SKYWAYS_KITCHEN_MODEL_FILES, skywaysKitchenModelKeysFor} from './gen/skyways/kitchenKinds'; // task studio-skyways-level-20261106-054448 (lane FOOD)
import {SKYWAYS_ADDON_MODEL_FILES, skywaysAddonModelKeysFor} from './gen/skyways/addonKinds'; // task studio-skyways-level-20261106-054448 (lane ADDON)
import {installSkywaysAddon, type SkywaysAddonRuntime} from './world/skywaysAddonRuntime'; // (lane ADDON) art atlases, turntable, velvet ropes
import {applySkywaysStageSupport} from './gen/skyways/stageSupport'; // (lane VENUE) the convention stage is walkable: its deck / steps lift the floor under them
import {SKYWAYS_DEST_MODEL_FILES, skywaysDestModelKeysFor} from './gen/skyways/destinations/skywaysDestModels'; // task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS)
import {installSkywaysDestinations} from './world/skywaysDestRuntime'; // (destinations, lane LANDMARKS) the posters' / plaques' art atlases
import {installSkywaysArchTextures} from './world/skywaysArchTextures'; // task studio-skyways-rework-20261107-054512-01 (lane ARCH): court / bridge finish textures
import {installMarketTextures} from './world/marketTextures'; // task studio-survivor-market-20261108-005807-01 (lane LEVEL)
import {installMarketVisuals} from './world/marketVisuals'; // task studio-survivor-market-20261108-005807-01 (lane LEVEL)
import {skywaysGardenModelKeysFor} from './world/skywaysGardens'; // (lane ARCH) the planters' foliage model
import {SKYWAYS_LAYOUT_LANE, skywaysLayoutVersionFor} from './gen/skyways/layoutVersion'; // task studio-skyways-destinations-20261106-170011-01
import {MARKET_LAYOUT_LANE, marketLayoutVersionFor} from './gen/market/layoutVersion'; // task studio-market-rework-20261108-074144-01 (lane LAYOUT)
import {BUNKER_LAYOUT_LANE, bunkerLayoutVersionFor} from './gen/bunker/layoutVersion'; // task studio-bunker-level-20261109-072224-01 (lane LEVEL)
import {ROSTER_LANE, rosterVersionFor} from './ai/enemyRoster'; // task studio-screacher-production-20261110-221858-01: the seeded family roster's version pin
import {noisyPhysicsAudio} from './ai/screacherNoise'; // task studio-screacher-production-20261110-221858-01: prop / item contacts as world noise
import {setObjectiveTitle} from './ui/objectiveTitle'; // task studio-bunker-rework-20261109-205115-01
import {installSkywaysDestAudio} from './world/skywaysDestAudio'; // task skyways-destinations-20261106 (lane AUDIO): the destinations' location sounds
import {installSubwayMapRead} from './world/subwayMapRead'; // task studio-ui-subway-maps-20261108-074144-01: the station map kiosks' close-up read
import {installSkywaysMapRead} from './world/skywaysMapRead'; // task studio-skyways-rework-20261107-054512-01 (lane MAPS): the directory boards' close-up read
import {installMarketTrade, type TradeSystem} from './market/trade/tradeSystem';
import {MARKET_HUMAN_MODEL_FILES} from './market/humanLooks'; // task studio-survivor-market-20261108-005807-01 (lane HUMANS): the friendly cast file
import {installMarketPeople, type MarketPeople} from './market/marketPeople'; // (lane HUMANS): the market's residents + stall traders // task studio-survivor-market-20261108-005807-01 (lane TRADE): Rail Ties + the six stalls
import {installMarketCombat, playerPelletDamage, type MarketCombat, type MarketCombatant} from './market/combat/marketCombat'; // task studio-market-rework-20261108-074144-01 (lane COMBAT)
import type {MarketHostilityApi} from './market/hostility';
import type {BeerEffectsApi, VomitApi} from './market/beer/effectsApi'; // task studio-market-bar-20261108-225231-01 (seams)
import {installBeerEffects} from './market/beer/beerEffects'; // (lane BEER) the one timed beer, the Bock's overfill, the Pilsner's acquisition hook
import {preloadBeerLabels} from './market/beer/beerModel'; // (lane BEER) the bottles' Codex label atlas before the item templates / icons
import {isBeer} from './items/beers';
import type {MarketAudioApi} from './market/marketAudio';
import {installMarketAudio} from './market/audio/marketSounds'; // task studio-market-bar-20261108-225231-01 (lane AUDIO): Game.marketAudio
import {installVomit, type VomitAction} from './player/vomit'; // task studio-market-bar-20261108-225231-01 (lane SHELVES): the throw-up action (Game.vomit)
import {installMarketWares, type MarketWares} from './market/wares/wares'; // task studio-market-rework-20261108-074144-01 (lane WARES): the stalls' owned stock on display, the red Steal
import {installLockbox, type LockboxSystem} from './ui/lockboxView'; // task train-lockbox-windows-20261101-232156 (lane BOX): the train's 40-slot Lockbox view + 1337 drop
import {installSkywaysTrunk} from './world/skywaysCarTrunk'; // task studio-beta-skyways-vehicle-20261107 (lane TRUNK): the Skyways car's 16-slot trunk
import {installTrainRide, type TrainRide} from './world/trainRide'; // task campaign-foundation-20261102 (lane RIDE): the moving train (ride mode, transit tunnel)
import {installRidePortals, type RidePortalRuntime} from './world/ridePortalRuntime'; // task studio-perf-ao-train-continuity-20261110-022206-01: the ride portals (gates / breaches) the moving train uses
import {installTrainCargo, type TrainCargoSystem} from './world/trainCargo'; // task train-loose-cargo: every loose item / bag aboard travels with the train
import {carriedModelKeys, installTrainPropCargo, type TrainPropCargo} from './world/trainPropCargo'; // task train-all-cargo: every movable prop aboard travels too
import {installCorpses, type CorpseSystem} from './world/corpses'; // task studio-corpse-chipper-fuel-20261110-235304-01 (lane CORPSE): carried dead bodies
import {groundDropSpots} from './world/dropScatter'; // task studio-refinement-batch-20261113-035659-01 (lane DROPS): inventory drops scatter
import {CORPSE_BUYER_MODEL_FILES, installCorpseShop, type CorpseShop} from './market/corpseShop/corpseShop'; // task studio-corpse-market-shop-20261114-031614-01: the Market den's corpse buyer
import {installChipper, type ChipperSystem} from './world/chipper'; // task corpse-chipper (lane CHIPPER): the woodchipper fixed in the train
import {installTrainEquipment, type TrainEquipmentSystem} from './world/trainEquipment'; // task train-crafting (lane EQUIP): the crafted chests / devices as physical cargo, the three plugs
import {installCraftBench, type CraftBenchSystem} from './world/craftBench'; // task train-crafting (lane BENCH): the crafting bench + its recipe list
import {installSaveTerminal, type SaveNowResult, type SaveRefusal, type SaveTerminalSystem} from './world/trainSaveTerminal'; // task refinement-batch (lane SAVE): the manual Save terminal
import {installSentryTurret, type SentryTurretSystem} from './world/sentryTurret'; // task train-crafting (lane SENTRY): the sentry's ammo + roof turret
import {installItemScanner, type ItemScannerSystem} from './world/itemScanner'; // task train-crafting (lane SCANNER): the scanner's scope
import {installTrainArmor, type TrainArmorSystem, type TrainUpgradesApi} from './world/trainArmor'; // task refinement-batch (lane ARMOR): the permanent train armour + the upgrades seam
import {installTrainOnboarding, type TrainOnboarding} from './world/trainOnboarding'; // task first-player-onboarding: the train's seven 3D guide markers
import {installAcidMelt, type AcidMelt} from './world/acidMelt'; // task studio-refinement-batch-20261113-035659-01 (lane MELT): acid melts world props
import {OnboardingStore, browserOnboardingStorage} from './ui/onboardingStore'; // (the same task) the browser-global tutorial record
import type {PropPlacement} from './gen/props';
import {SingleFlight, travelRefusal, type TravelResult} from './run/travelGate';
import {OFFICE_MODEL_FILES} from './assets/officeAssets'; // Iteration 16 (lane ASSETS registry): office models load through propModels
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from './assets/companyAssets'; // Task office-overhaul-20261030 (lane TENANTS): company models load lazily per layout (officeModelKeysFor); lane FURN (office-props-physics-scale-20261030): + the separated loose clutter
import {MALL_MODEL_FILES} from './assets/mallAssets'; // Task track3-eaton-centre-20261031 (lane ASSETS): mall-art models (keys office-<id>, level-only paths assets/models/mall-*.glb), fetched only for the keys a mall layout places
import {lingerieDisplayModelKeys} from './gen/mall/lingerieStore'; // task mall-lingerie-20261102 (lane STORE): the store's display sets (lane FIT's files)
import {officeModelKeysFor} from './gen/office/index'; // Iteration 16 (lane WORLD-GEN): the office models a section placed
import {preloadOfficeAssets} from './world/officeProps'; // Iteration 16 (lane WORLD-GEN): carpet / ceiling / partition textures
import {placementBox} from './items/lootLayout';
import {adaptToSoftwareGl, type SoftwareGlState} from './render/softwareGl';
import {observeBackendAnisotropy} from './render/anisotropy'; // Task mall-playtest-revision-20261031 (lane FIX, U08): 16x surface anisotropy, QA counts
import {requestArchitectureAnisotropy} from './world/surfaceAnisotropy'; // (lane FIX, U08)
// Iteration 13 (CORE): WebGPURenderer (WebGPU backend, WebGL 2 fallback), backend diagnostics, viewmodel overlay pass
import type {WebGPURenderer} from 'three/webgpu';
import {createGameRenderer, describeBackend, maxTexture3DSize, recordGpuError, rendererRequest, watchDevice, type GameRenderer, type GpuInfo} from './render/backend';
import {OverlayPass} from './render/overlay';
import {installFlareLightNode} from './world/flareLight'; // Iteration 15
import {SteamVents, annexVents, steamLight} from './world/trackExt/steam'; // Track 2 (VIS): non-hazardous annex steam
import {WarmupRegistry, planWarmup, prepareObjects, runWarmup, skippedWarmup, warmupLabel, warmupNote, type WarmupMode, type WarmupProgress, type WarmupRenderer, type WarmupResult} from './render/warmup'; // Iteration 14
import {RuntimeVariantPool, runtimeVariantsFirst} from './render/runtimeVariants'; // task runtime-variant-warmup-20261105: play-only variants as warm-up prototypes
import {drawWithSceneMatricesOnce} from './render/sceneMatrices'; // task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): one matrix update a frame
import {woundsOf} from './damage/wounds'; // (the enemies' wound layers: their flesh-chunk material variants)
import {renderContextDepth} from './render/renderContextDepth'; // task studio-performance-recorder-20261103 (lane RENDER-CPU)
import {installShadowAlphaTwin} from './render/shadowOverride'; // (lane RENDER-CPU)
import {installUploadDedupe} from './render/uploadDedupe'; // task mall-horde-performance-20261105
import {JourneyCompile, type JourneyCompileOptions} from './render/journeyCompile'; // (lane RENDER-CPU: the journey's sliced preparation)
import {renderPixelRatio, type RenderScale} from './ui/settingsStore'; // task campaign-foundation-20261102 (lane MENU): render resolution x the DPR cap
import {loadingPlaceName, type LastSaveStatus} from './ui/loadingScreen'; // task studio-beta-campaign-polish-20261103-063841-01 (lane MENU): loading name only; Load last save
import type {LoadMeter} from './ui/loadingMap'; // task studio-initial-loading-subway-graphic-20261111-070741-01: the loading screen's map takes the load's progress
import {applyMouseLook, lookSigns} from './player/mouseLook'; // task studio-beta-mouse-axis-invert-20261105-005156-01: the one mouse-look step (X / Y inverts)

export type GameState = 'loading' | 'title' | 'playing' | 'paused' | 'inventory' | 'dead' | 'won' | 'error' | 'map'; // ('map': the campaign's paper map overlay — the world holds)

/** Task studio-alpha-campaign-foundation-20261102-230708-01: the ordinary station objective (no kill goal). */
export const SCAVENGE_OBJECTIVE = 'Scavenge fuel and supplies. Return to the train when done.'; // (task train-fuel-system: the train needs a tank of fuel per stop)
/** Task studio-survivor-market-20261108-005807-01 (lane LEVEL): the Survivor Market's objective line (a calm pit stop: trade, then ride on). */
export const MARKET_OBJECTIVE = 'Trade at the stalls. Return to the train when done.';
/** Task studio-bunker-level-20261109-072224-01 (lane LEVEL): the Bunker's objective line (scavenge; the optional generators / core). */
export const BUNKER_OBJECTIVE = 'Scavenge the shelter · optional: restart three generators to power the core. Return to the train when done.';

// (task campaign-foundation-20261102, lane MENU: + renderScale — a linear render-resolution scale over the DPR-capped native buffer;
// the persisted values live in ui/settingsStore.ts, main.ts copies them in; task studio-perf-ao-train-continuity-20261110-022206-01, lane AO:
// + ambientOcclusion, the atmosphere pass's screen-space AO on / off)
export interface Settings { sens: number; fov: number; volume: number; muted: boolean; invertX: boolean; invertY: boolean; quality: 'low' | 'high'; renderScale: RenderScale; trainSway: number; ambientOcclusion: boolean }

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

/**
 * Iteration 14: warm-up scope. `?warmup=off|view|full` overrides; otherwise the whole station on a hardware GPU and only
 * the spawn neighbourhood on a software rasterizer (it JITs every program into system memory; render/warmup.ts).
 */
/**
 * Iteration 14: where a warm-up shows its progress (the loading screen, or the pause panel's status line). Task
 * studio-initial-loading-subway-graphic-20261111-070741-01: `meter` = the loading screen's map (ui/loadingMap.ts), which took the
 * progress bar's place; it is told each stage's real progress and that the load is ready, nothing else.
 */
export interface WarmupUi { meter: LoadMeter | null; label: HTMLElement; button: HTMLButtonElement | null }
/** Iteration 16: let the browser paint a loading screen / overlay before a long synchronous generation. */
const nextPaint = () => new Promise<void>(r => setTimeout(r, 30));

export function warmupMode(search: string, software: boolean): WarmupMode {
  const v = new URLSearchParams(search).get('warmup');
  if (v === 'off' || v === 'view' || v === 'full') return v;
  return software ? 'view' : 'full';
}

/**
 * A timed item use. Task studio-beta-mouse-axis-invert-20261105-005156-01 (user follow-up, consumable return): `held` = the selection
 * when the used stack WAS the held item (quick slot `index`, never the melee slot), else absent (quick heal / inventory use of another stack).
 */
interface UseAction { uid: number; itemId: string; t: number; total: number; held?: {index: number} }

/**
 * Task studio-beta-mouse-axis-invert-20261105-005156-01 (user: "when switching from an item (eg gun) to a consumable item (eg chocolate
 * bar), after consuming it, auto switch back to original item that you came from"): the item held before a DELIBERATE switch (1-5, the
 * wheel, ~, inventory Equip) to a held consumable — `uid` in the melee slot (`melee`) or a quick slot — and the consumable switched to.
 * Task studio-beta-consumable-stack-return-20261105-045347-01 (user correction: "it should only apply if you consume the last item in the
 * stack. If there are more items in the stack, i.e. bandages, it should stay selected so the player may consume multiple"): it stays
 * pending across every use of that stack and is used only by the use that empties it.
 */
interface ConsumeReturn { melee: boolean; uid: number; consumableUid: number }

export class Game {
  /** Iteration 13 (CORE): three r186 WebGPURenderer — usable only after `await initRenderer()` (main.ts boot). */
  readonly renderer: WebGPURenderer;
  /** Iteration 13 (CORE): the backend that actually initialized (render/backend.ts); null until initRenderer() resolves. */
  gpu: GpuInfo | null = null;
  private readonly gpuBoot: GameRenderer;
  private gpuInit: Promise<GpuInfo> | null = null;
  /** Iteration 13 (CORE): viewmodel overlay target + composite (render/overlay.ts). */
  readonly overlay: OverlayPass;
  /** Iteration 13 (CORE): set when the atmosphere module cannot run on this renderer; the station then renders directly. */
  atmosphereBypass: string | null = null;
  readonly scene = new THREE.Scene();
  // Far plane just past where FogExp2(0.038) is ~99.8% opaque: on the 130 m+ platforms this lets
  // chunked instancing cull far fixtures/props that would be invisible anyway.
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
  readonly input: Input;
  readonly hud = new Hud();
  readonly sfx = new Sfx();
  readonly settings: Settings = {sens: 1, fov: 75, volume: 0.7, muted: false, invertX: false, invertY: false, quality: 'high', renderScale: 1, trainSway: 1, ambientOcclusion: true};
  // ==== task campaign-foundation-20261102 (lane MENU): main-menu hooks (main.ts / world/menuScene.ts) ====
  /** The main menu's diorama render (world/menuScene.ts), drawn by frame() in 'title' / 'loading' while no world is built; true when it drew. */
  menuRender: ((time: number) => boolean) | null = null;
  /** A setting changed inside the game (the M mute toggle): main.ts writes it back to the settings store. */
  onSettingsChanged: ((key: keyof Settings) => void) | null = null;
  // ==== end lane MENU ====
  /** Task studio-initial-loading-subway-graphic-20261111-070741-01: the loading screen's map (ui/loadingMap.ts; main.ts mounts it). */
  loadMeter: LoadMeter | null = null;
  state: GameState = 'loading';
  assets!: AssetBundle;
  /** Iteration 07 (Lane P2): lazy per-station prop models (gen/props07.ts); only the kinds a station placed are fetched. */
  readonly propModels = new PropModelLibrary({...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...ENEMY_MODEL_FILES, ...MALL_MODEL_FILES, [ANNEX_GENSET.key]: {url: ANNEX_GENSET.url, bytes: ANNEX_GENSET.bytes}, ...PLAYER_TRAIN_MODEL_FILES, ...REACTOR_MODEL_FILES, ...WASTE_MODEL_FILES, ...LINGERIE_MODEL_FILES, ...COSPLAY_MODEL_FILES, ...SKYWAYS_KITCHEN_MODEL_FILES, ...SKYWAYS_ADDON_MODEL_FILES, ...SKYWAYS_DEST_MODEL_FILES, ...MARKET_HUMAN_MODEL_FILES, ...SHELF_JUNK_MODEL_FILES, ...BUNKER_KIT_MODEL_FILES, ...CORPSE_DEN_MODEL_FILES, ...CORPSE_BUYER_MODEL_FILES}); // (task studio-food-shelf-production-20261109-002816-01: + the shelf-junk atlas, lazy) // (survivor market, lane HUMANS: + the friendly cast, level-only market-*) (skyways destinations, lane LANDMARKS: + the destination kit's built models, level-only skyways-d-*) (skyways lane ADDON: + the convention / prize-car models, level-only skyways-*) (skyways lane FOOD: + the ramen restaurant's range / cookware / mascot, level-only skyways-*) (task mall-lingerie, lane CONTEXT: + the lingerie garments, lazy) Iteration 16 (RUN): + the office GLBs (lane ASSETS); office-overhaul (TENANTS): + company models; track1 (lane BLIGHT): + the lazy enemy models; track3 (ASSETS): + mall models; player-train (lane TRAIN): + the train's shell / door leaf / desk; reactor-build (lane ARCH): + the Reactor kit
  /** Task track3-eaton-centre-20261031 (lane PACKAGE): textures / GPU resources owned by ONE level, released when the level changes (assets/levelResources.ts). */
  readonly levelResources = new LevelResources();
  /** Pistol lane: legacy `?devpistol=1` flag (pre-art staging); no longer needed now that PISTOL_ART_READY. */
  readonly devPistol = devPistolRequested();
  /** Starting weapon: the pistol (PISTOL_ART_READY: the user's pistol.glb is in), so rifle + shotgun are seeded finds. Generation receives it. */
  readonly startWeapon: StartWeapon = startWeaponFor(this.devPistol);
  mats!: WorldMaterials;
  viewmodel!: Viewmodel;
  layout!: StationLayout;
  world!: BuiltWorld;
  /** Station lighting (iteration 05: baked persistent light field + tube glow; historical field name). */
  lightPool!: StationLighting;
  propIndex!: PropIndex;
  pathfinder!: PathFinder;
  /** Task office-overhaul-20261030 (lane AUDIO): the shared navigable-distance field from the player (enemy vocal gate; ai/vocalReach.ts). */
  vocalReach: VocalReach | null = null;
  /** Task frame-budget-deferral-20261030 (lane SCHED): the brains' path requests — far, not-in-sight chase re-plans as frameBudget jobs (ai/pathService.ts). */
  pathService: PathService | null = null;
  /** Task track3-eaton-centre-20261031 (lane HORDE): the live section's roaming-horde director (null: the level has no hordes). */
  hordes: HordeDirector | null = null;
  /** Lane HORDE (atrium AI): the open-atrium level's shared recent chase routes (null: not an atrium level — Subway, Office). */
  chaseShare: ChaseShare | null = null;
  /**
   * Iteration 08 (Lane B): the station's stacked levels — every y-aware world query (support,
   * collision, ceilings, 3D raycasts / sight, nav). One level on single-storey layouts.
   */
  levels!: Levels;
  readonly player = new Player();
  /** Hunger/thirst (FOOD/WATER bars): 80/80 on every spawn, slow drain while playing. */
  readonly survival = new Survival();
  inv = new Inventory();
  weapon = new WeaponController();
  /** Every enemy actor (zombies + iteration-07 archetypes such as the rat/dog; ai/creatureArchetypes.ts EnemyActor). */
  zombies: EnemyActor[] = [];
  /** Spawns whose archetype model was missing and fell back to a zombie (QA). */
  enemyFallbacks = 0;
  /** Iteration 05 body x outfit registry/assembler (ai/outfits.ts), built once from the loaded GLBs. */
  private zombieLooks: ZombieLookLibrary | null = null;
  /** Task mall-lingerie-20261102-221554 (lane CONTEXT): the separate lingerie look library over the loaded lazy garments (rebuilt when they change). */
  private lingerieLooks: {models: readonly unknown[]; lib: WardrobeLibrary} | null = null;
  private cosplayLooks: {models: readonly unknown[]; lib: WardrobeLibrary} | null = null; // (lane COSPLAY)
  pickups!: PickupManager;
  readonly fx = new Effects();
  private readonly strainerTrail = new StrainerWetTrail(); // (Strainer wet-shine trail driver; marks live in fx)
  /** Ragdolls (cannon-es) + pooled casings; rebuilt per station, stepped only while playing. */
  readonly physics = new PhysicsSystem(this.scene, this.physicsAudio());
  /**
   * Task studio-screacher-production-20261110-221858-01: the physics systems' audio sink — the Sfx, wrapped so that a loose object's
   * contact (a prop the player walked into, a kicked can, shelf stock falling, a thrown flare landing) and a dragged box are ALSO
   * raised as world noise where they happened (ai/screacherNoise.ts; only Screachers listen: worldNoise).
   */
  private physicsAudio(): PhysicsAudio {
    return noisyPhysicsAudio(this.sfx, (x, y, z, radius, kind) => this.worldNoise(x, y, z, radius, kind));
  }
  /** Iteration 06 (Lane D): material damage — craters, debris, per-instance prop damage / breaking, zombie wounds. */
  readonly damage = new DamageSystem(this.fx, this.sfx);
  /** Iteration 08 (Lane S): real 3D filler stock on retail shelving — physical on demand, never loot (world/shelfStock.ts). */
  readonly stock = new ShelfStock(this.fx, this.sfx);
  /** Iteration 12 (primary contract): player-made light the world reacts to (flashlight, flares, body glow); world/lightSources.ts. */
  readonly lightSources = new LightSources();
  readonly invUI: InventoryUI;
  private readonly flashlight: THREE.SpotLight;
  /** Iteration 12 (LIGHT): flashlight battery / flicker + body glow + their light sources (player/flashlight.ts). */
  readonly torch: PlayerLight;
  /** Iteration 12 (LIGHT): thrown road flares (weapons/throwables.ts; a cannon BodySource of `physics`). */
  readonly flares = new FlareSystem(this.scene, this.physics, this.lightSources);
  /** Task studio-refinement-batch-20261113-035659-01: the crafted acid / lure grenades' canisters, acid pools and lures (weapons/grenades.ts). */
  readonly grenades = new GrenadeSystem(this.scene, this.physics);
  /** The throwable a grenade-style hold readies / throws (its item id: the flare or a crafted grenade; null when idle). */
  private throwItem: string | null = null;
  /** Task studio-refinement-batch-20261113-035659-01 (lane LURE): the lure grenade's scent emitters enemies walk to (ai/scentLure.ts; no sight needed). */
  readonly scents = new ScentLures();
  /** Track 2 (VIS): the service annexes' steam vents (visual only; Effects' bounded steam ring). */
  private steamVents: SteamVents | null = null;
  /** Iteration 15: grenade-style flare input (T, or left click with a flare in hand): hold readies, release throws once. */
  readonly flareHold = new FlareHold();
  /** Iteration 15: the left button belonged to a flare hold; the gun ignores it until it is released. */
  private lmbLatch = false;
  /** A lane owned the mouse buttons last frame (inputOwners; task fuel-feedback: its release latches a still-held left button). */
  private laneOwnedLast = false;

  // ==== Iteration 16 shared plumbing (primary) — lanes REGISTER into these; they do not rewrite each other's code ====
  /** Per-frame modifier contributors (lane GEAR: worn gear; lane INJURY: limb injuries). Combined from base values each frame. */
  readonly modifierSources: ModifierSource[] = [];
  /** This frame's combined modifiers (player/modifiers.ts). */
  mods: PlayerModifiers = {...BASE_MODIFIERS};
  /** Called with every resolved hit on the player, after armor and HP (lane INJURY rolls limb injuries here). */
  readonly hitListeners: ((hit: ResolvedHit) => void)[] = [];
  /** E-key handlers tried before the default interaction (lane GEAR: grounded backpack; lane TOWER: elevator / stair doors). Return true when handled. */
  readonly interactHandlers: (() => boolean)[] = [];
  /**
   * Task office-overhaul-20261030 (lane LIFT): left-click handlers for in-world targets (the elevator's physical buttons), tried
   * right after E and before fire / flare / item use / the lane frame hooks. True = handled: the press is consumed (mousePressed
   * cleared) and lmbLatch keeps the gun off the button until it is released.
   */
  readonly pointerHandlers: (() => boolean)[] = [];
  /** Per-section build hooks: `build` after a section's world is built (before warm-up), `teardown` before it is torn down. */
  /**
   * … `holders` (task fuel-feedback, world/fuelStations.ts): runs right after the loot holders are built — before the shelf filler is
   * dressed around their lots and before the section memory removes the taken ones (extra lots that must behave like rolled loot).
   * It gets the section being BUILT: during a journey run.current is still the station being left until the 'arrival' step.
   */
  readonly sectionHooks: {holders?(layout: Iter16Layout, key: SectionKey): void; build?(layout: Iter16Layout): void; teardown?(): void}[] = [];
  /** Aim offset (radians) added to the camera every frame (lane INJURY: restrained arm-injury sway). Shots use the camera, so it is honest. */
  readonly aimOffset = {yaw: 0, pitch: 0};
  /** Per-frame lane updates while playing (after the player moved, before the camera update). */
  readonly frameHooks: ((dt: number) => void)[] = [];
  /** Iteration 16 (lane GEAR; TOWER may use them too): lane prompts shown before the pickup / container / ladder prompt (the matching interactHandler takes E first). */
  readonly promptProviders: (() => string | null)[] = [];
  /** Iteration 16 (lane GEAR): a lane UI / action owns the mouse buttons (readied / open backpack): no fire, ADS, item use or flare while any returns true. */
  readonly inputOwners: (() => boolean)[] = [];
  /**
   * Task studio-corpse-chipper-fuel-20261110-235304-01: listeners of WORLD noises (ai/worldNoise.ts emitWorldNoise: a machine's start /
   * feed / grind at its own position, after the existing enemies heard it). A listener never re-emits.
   */
  readonly worldNoiseListeners: ((n: import('./ai/worldNoise').WorldNoise) => void)[] = [];
  /** Iteration 16 (lane GEAR): worn gear, the deployable backpack (6) and grounded bags (gear/system.ts). */
  readonly gear: GearSystem;
  /** Task gasmask-breach-20261030 (mask lane): the gas mask — Q on / off, filter charge + spares, Q HUD cell, the first-person mask view; protects() (gear/gasMask.ts). */
  readonly gasMask: GasMaskSystem;
  /** Task train-fuel-system (lane PORT): the train's fuel cap — E pours one fuel can into the tank; the HUD fuel readout (world/fuelPort.ts). */
  readonly fuelPort: FuelPortSystem;
  /** Task train-fuel-system (lane CART): the fuel carts in the world — push / grab, the hose, cargo riding the train (world/fuelCarts.ts). */
  fuelCarts!: FuelCarts;
  /** Task train-loose-cargo: the train's loose items / bags (world/trainCargo.ts). */
  trainCargo!: TrainCargoSystem;
  /** Task studio-beta-train-all-cargo-20261107-184244-01: the movable props aboard (world/trainPropCargo.ts). */
  trainPropCargo!: TrainPropCargo;
  /** Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CORPSE): dead bodies picked up / carried / put down / aboard (world/corpses.ts). */
  corpses!: CorpseSystem;
  /** Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CHIPPER): the woodchipper fixed in the train (world/chipper.ts): feed dead bodies, fuel. */
  readonly chipper: ChipperSystem;
  /** task studio-corpse-market-shop-20261114-031614-01: the Market den's corpse buyer (market/corpseShop/corpseShop.ts; inert without layout.market.den). */
  corpseShop!: CorpseShop;
  /**
   * Task studio-train-crafting-v1-20261111-225628-01: the crafted train equipment (world/trainEquipment.ts: chests / devices as physical
   * cargo, the three generic plugs), the crafting bench (world/craftBench.ts), the sentry's roof turret (world/sentryTurret.ts) and the
   * item / enemy scanner (world/itemScanner.ts).
   */
  readonly trainEquipment: TrainEquipmentSystem;
  readonly craftBench: CraftBenchSystem;
  readonly sentryTurret: SentryTurretSystem;
  readonly itemScanner: ItemScannerSystem;
  /** Task studio-refinement-batch-20261113-035659-01 (lane SAVE): the train's Save terminal left of the desk (world/trainSaveTerminal.ts; [E] -> saveNow). */
  readonly saveTerminal: SaveTerminalSystem;
  /** Task studio-refinement-batch-20261113-035659-01 (lane ARMOR): the train armour (kit, colliders, zombies-only contact damage) and the
   *  train upgrades seam the bench's recipe calls (installed / block / install: the craft debits first, a false install refunds). */
  readonly trainArmor: TrainArmorSystem;
  readonly trainUpgrades: TrainUpgradesApi;
  /** Task first-player-onboarding: the browser-global tutorial record (never in a save) and the train's first-player markers. */
  readonly onboarding: OnboardingStore;
  readonly trainOnboarding: TrainOnboarding;
  /** Task studio-refinement-batch-20261113-035659-01 (lane MELT): acid melting world props (world/acidMelt.ts; the acid grenade's seam). */
  acidMelt: AcidMelt | null = null;
  /** Task studio-survivor-market-20261108-005807-01 (lane TRADE): market trade (market/trade/tradeSystem.ts); since the rework Rail Ties are a physical item. */
  trade!: TradeSystem;
  /** Task studio-weapon-runtime-fix-20261110-022206-01: the delivery of the new weapons' lazily loaded models (world/weaponVarietyDelivery.ts). */
  weaponVariety!: WeaponVarietyDelivery;
  /** Task studio-survivor-market-20261108-005807-01 (lane HUMANS): the market's residents + traders (market/marketPeople.ts). */
  marketPeople!: MarketPeople;
  /** Task studio-market-rework-20261108-074144-01 (lane COMBAT): attackable market people, the settlement's hostility, their gunfire (market/combat/marketCombat.ts). */
  marketCombat!: MarketCombat;
  /** (lane COMBAT) The market hostility seam (market/hostility.ts) the trade / wares lanes call: hostile, provoke, canTrade. */
  marketHostility!: MarketHostilityApi;
  /** Task studio-market-bar-20261108-225231-01 (seams; market/beer/effectsApi.ts, market/marketAudio.ts): the one timed beer's effects, the
   *  player's throw-up action and the market's sounds — set by their installs; read with optional chaining. */
  beerEffects?: BeerEffectsApi;
  vomit?: VomitApi;
  marketAudio?: MarketAudioApi;
  /** (lane SHELVES) Game.vomit's implementation (player/vomit.ts): its held-item lowering, read by the viewmodel step. */
  private vomitAction: VomitAction | null = null;
  /** Task studio-market-rework-20261108-074144-01 (lane WARES): the stalls' real stock displayed as owned world items; theft (market/wares/wares.ts). */
  marketWares!: MarketWares;
  /** Task skyways-level-20261106 (lane CAR): the Skyways prize car — while `driving`, update() steps the player through it (world/skywaysCar.ts). */
  skywaysCar!: SkywaysCar;
  /** Task office-overhaul-20261030 (lane INTERACT, #13): bathroom stalls — door collision, walk-in, close refusal, toilet model (world/stalls.ts). */
  readonly stalls: StallSystem;
  /** Iteration 16 (lane INJURY): limb injuries (player/injuries.ts) — RUN carries snapshot() / restore(), NewGame calls reset(). */
  readonly injuries: InjurySystem;
  /** Iteration 16 (lane TOWER): the office tower runtime — elevator, stairwell doors, window glass, exterior city (world/towerRuntime.ts). */
  readonly tower: TowerRuntime;
  /** Task studio-skyways-level-20261106-054448 (lane GAS): the Skyways glazing — breakable panes, pre-breached bridges (world/skywaysWindows.ts; inert elsewhere). */
  readonly skywaysWindows: SkywaysWindowRuntime;
  /** Task studio-skyways-level-20261106-054448 (lane ADDON): the add-on's art atlases, the prize turntable and velvet ropes (world/skywaysAddonRuntime.ts; inert elsewhere). */
  readonly skywaysAddon: SkywaysAddonRuntime;
  /** Task player-train-shell-20261101-202805 (lane TRAIN): the parked player train in the world — the car, its interior volume / colliders, doors, lights (world/playerTrain.ts). */
  readonly trainRuntime: PlayerTrainRuntime;
  /** Task train-lockbox-windows-20261101-232156 (lane BOX): the Lockbox transfer view / developer drop (ui/lockboxView.ts); the store is playerTrain.lockbox. */
  readonly lockbox: LockboxSystem;
  /**
   * Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the MOVING train (world/trainRide.ts) — depart() / arrive() /
   * enterTransit() for the primary's travel orchestration; while it rides, update() steps the player through it (car-local frame).
   */
  readonly trainRide: TrainRide;
  /** Task studio-perf-ao-train-continuity-20261110-022206-01: the ride portals of the parked car's track (world/ridePortalRuntime.ts). */
  readonly ridePortals: RidePortalRuntime;
  /**
   * Task gasmask-breach-20261030 (lane GAS): a bullet / pellet's world hit, offered before the damage system — true = handled (no
   * crater / prop damage), e.g. an office window pane took it. `shot` = the trigger pull (every pellet of one pull shares it);
   * `damage` = what this ray deals (weapon damage x range falloff; task gas-mask-roof-feedback-20261030: pane health).
   */
  readonly bulletHitHandlers: ((wh: WorldHit, point: THREE.Vector3, dir: THREE.Vector3, shot: number, damage: number) => boolean)[] = [];
  /** Task gasmask-breach-20261030 (lane GAS): breakable office windows, the breach gas field and its exposure (`gas.protection`). */
  readonly gas: GasSystem;
  /** Task gas-mask-roof-feedback-20261030 (item 1): coughing while toxic gas hurts the unprotected player (audio/cough.ts). */
  readonly cough: CoughFeedback;
  /** Task track1-siren-blightbelly-20261031 (lane BLIGHT): the Blightbelly death burst — blast, pustule VFX, burst / hiss, gas puff (ai/blightBurst.ts). */
  readonly blight: BlightBurstSystem;
  /** Task track1-siren-blightbelly-20261031 (lane SIREN): Siren lifecycle — dormant vein patches, wake persistence, model-missing skip (ai/sirenSystem.ts). */
  readonly sirens: SirenSystem;
  // ==== Iteration 16 (lane RUN): the run — logical levels, sections, travel, carryover (lanes/run.notes) ====
  /** The current run (run/runState.ts): level seeds, gear roll, section memories, the Retry-level snapshot. Replaced by NewGame. */
  run: RunState = createRun({seeds: {subway: freshSeed(), office: freshSeed(), mall: freshSeed(), market: freshSeed(), bunker: freshSeed(), skyways: freshSeed(), reactor: freshSeed()}, start: {level: 'subway', section: 'main'}, levels: LEVELS}); // (+ mall: task track3-eaton-centre-20261031, lane GEN; + reactor: task reactor-build-20261101)
  /** How the player arrived in the current section (lane TOWER: kind 'elevator' starts inside the cab, doors closed). */
  arrival: Arrival = {kind: 'start'};
  /** Run-scoped lane state (INJURY / GEAR): saved at level entry (Retry), restored by Retry level, reset by NewGame — never by travel. */
  readonly runParticipants: RunParticipant[] = [];
  /**
   * Task player-train-shell-20261101-202805 (lane PLACE): the current level's parked player train (gen/playerTrain.ts; null = the level
   * cannot fit it), set in buildSection before the start pose and the section hooks — lane TRAIN builds the car here. `playerTrain` is
   * the run's ONE train identity (run/playerTrain.ts, RunParticipant 'player-train').
   */
  trainPlacement: TrainPlacement | null = null;
  readonly playerTrain = new PlayerTrainRecord();
  /** Task train-fuel-system: the stations' finite fuel (world/fuelStations.ts). */
  fuelStations!: FuelStations;
  /** Called on every setState (lanes close their UIs when the state leaves 'playing'). */
  readonly stateListeners: ((state: GameState, prev: GameState) => void)[] = [];
  /** Awaited after a section is generated and before it is built (lazy models / textures the builder needs). */
  readonly sectionPreloads: ((layout: StationLayout) => Promise<void>)[] = [];
  /**
   * Task studio-beta-train-all-cargo-20261107-184244-01: layout augmentation — run in prepareSection right after generateSection (`phase`
   * 'prepare': before the model keys / preloads, with the run being prepared) and at the top of buildSection ('build': the installed run,
   * before anything reads the layout). The train's prop cargo appends the carried props here (world/trainPropCargo.ts).
   */
  readonly sectionLayoutHooks: ((layout: StationLayout, key: SectionKey, run: RunState, phase: 'prepare' | 'build') => void)[] = [];
  /** Extra `propModels` keys a section needs besides its p7 props (lane WORLD-GEN: office models): fetched before the build, kept by the trim. */
  // (round 2, R3) + the generated annex genset model on a layout with a genset record (a shared file: every annex-bearing level)
  // (task mall-lingerie-20261102, lane STORE) + the lingerie store's display sets: lane FIT's outfit files they are cut from (lazy, same keys)
  // (task mall-lingerie-20261102-221554, lane CONTEXT) + the lingerie garments on a layout with lingerie-tagged spawns (the mall's lingerie store only)
  readonly sectionModelKeys: ((layout: StationLayout) => readonly string[])[] = [officeModelKeysFor, gensetModelKeysFor, lingerieDisplayModelKeys, lingerieModelKeysFor, cosplayModelKeysFor, shelfJunkModelKeysFor, bunkerModelKindKeysFor, corpseDenModelKeysFor]; // (+ task studio-food-shelf-production-20261109-002816-01: the shelf-junk atlas only on layouts with stockable holders)
  /** One lifecycle operation at a time: travel, new game, retry level. */
  private readonly lifecycle = new SingleFlight();
  /** Live pickups that are (what is left of) a generated layout pickup -> its layout.pickups index. */
  private readonly layoutPickup = new Map<Pickup, number>();
  /** Live enemies -> their layout.zombies index (kills are remembered per index). */
  private readonly enemyIndex = new Map<EnemyActor, number>();
  /** Task gameplay-feedback-20261111 (lane SPAWNS): zone-local enemies -> their wander home (ai/wanderHome.ts; lingerie store, damp Strainer). */
  private wanderHomes = new Map<EnemyActor, WanderHome>();
  /** The current section was already cleared in this run (no second clear moment). */
  private sectionCleared = false;
  /** Flashlight switched on (Iteration 12: backed by the battery; a flat battery keeps it off). */
  get flashlightOn(): boolean { return this.torch.battery.on; }
  set flashlightOn(v: boolean) { this.torch.battery.setOn(v); }
  private readonly muzzleLight = new THREE.PointLight(0xffb468, 0, 8, 2);
  /** Iteration 06 (Lane F): volumetric haze pass + flashlight shadow map (render/volumetric.ts). */
  readonly atmosphere: VolumetricAtmosphere;
  // Constant dim ambient floor (iteration 05: no longer follows the player's area; the baked light
  // field in world/lights.ts carries all fixture light).
  private readonly hemi = new THREE.HemisphereLight(MOOD.hemiSky, MOOD.hemiGround, MOOD.ambient);
  stats = {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0};
  private recoilPitch = 0;
  private recoilYaw = 0;
  private bloom = 0;
  private shake = 0;
  private muzzleT = 0;
  private use: UseAction | null = null;
  /** Task mouse-axis-invert (consumable return): where one successful use of the held consumable returns to (null: nowhere). */
  private consumeReturn: ConsumeReturn | null = null;
  private aiming = false;
  private wonAt = -1;
  private rand: () => number = Math.random;
  private sharedGeometries = new Set<THREE.BufferGeometry>();
  private lastFrame = performance.now();
  private renderT = 0;
  private time = 0;
  private shotCounter = 0;
  private currentSeed = 0;
  /** Frames rendered while playing (used by QA to confirm the loop runs). */
  frames = 0;
  /**
   * Debug overlay (debug/overlay.ts): main-thread ms of the last frame()'s world update and render submission; deferredMs
   * (task frame-budget-deferral-20261030, lane SCHED) = its background chunks (frameBudget.run, same callback).
   */
  readonly frameCpu = {updateMs: 0, renderMs: 0, deferredMs: 0, rendered: false};
  /**
   * Task frame-budget-deferral-20261030 (lane SCHED): cooperative frame-budget scheduler for deferrable, chunked background
   * work (core/frameBudget.ts) — run after the update and the render submission in what is left of the frame's budget;
   * held outside play; its generation is bumped by every world teardown (leaveSection). `__LL.frameBudget()` reads it.
   */
  readonly frameBudget = new FrameBudget();
  /**
   * Task frame-budget-deferral-20261030 (lane MEASURE): opt-in profiler of frame() in named spans (debug/updateProfile.ts) —
   * off by default (each span boundary is one boolean check); `__LL.updateProfileStart()` / `updateProfile()` / `Stop()`.
   */
  readonly prof = new UpdateProfiler();
  /** Gameplay clock (s; advances only while the world updates). Iteration 17: QA / tests prove traversal never stops it. */
  get clock(): number { return this.time; }
  /**
   * Iteration 17 (seamless): how often each world-lifecycle entry point ran. Traversal inside a level (stairs, the moving
   * elevator) must never move any of these — tests and the browser spot check compare them before / after.
   */
  readonly lifecycleCounts = {generate: 0, prepare: 0, build: 0, leave: 0, travel: 0, warmup: 0, loading: 0};
  /** Iteration 14 (primary): the loading-screen render warm-up is running (render/warmup.ts); the loop neither updates nor renders. */
  warming = false;
  /** Iteration 14: the last warm-up's result (loading note, QA `__LL.warmup()`). */
  warmup: WarmupResult | null = null;
  private warmRun: Promise<WarmupResult> | null = null;
  /** Lane RENDER-CPU: the render-context call depth each scene-pass target is drawn at (render/renderContextDepth.ts), once measured. */
  private readonly sceneDepths = new WeakMap<object, number>();
  private sceneDepthLast: number | null = null;
  private journeyCompile: JourneyCompile | null = null;
  /**
   * Iteration 14: what the warm-up prepares besides the discovered station scene (docs/rendering-warmup.md): effect pools /
   * runtime prototypes in the scene, and render passes with their own scene / camera / target.
   */
  readonly warmRegistry = new WarmupRegistry();
  /** Task runtime-variant-warmup-20261105: the play-only variants' hidden prototypes (render/runtimeVariants.ts; QA `__LL.warmup()`). */
  readonly runtimeVariants = new RuntimeVariantPool();
  /** Iteration 14: the previous station's GPU-side releases, run after the new station's warm-up (see newStation). */
  private retired: (() => void)[] = [];
  /** Iteration 14: bumped by newStation (a running warm-up for the previous station stops at its next chunk). */
  private stationGen = 0;
  /** Iteration 08: renderer string + whether it is a software rasterizer (anisotropy capped at 1 there). Iteration 13: set by initRenderer(). */
  softwareGl: SoftwareGlState | null = null;
  lastError: string | null = null;

  constructor(readonly canvas: HTMLCanvasElement, readonly qa: boolean) {
    // Iteration 13 (CORE): WebGPURenderer (three/webgpu): WebGPU when the browser yields an adapter + device, else its built-in
    // WebGL 2 backend; ?renderer=webgl2 forces the fallback. Nothing renders / compiles before initRenderer() resolves.
    this.gpuBoot = createGameRenderer(canvas, rendererRequest(location.search, globalThis.navigator as {gpu?: unknown} | undefined, globalThis.isSecureContext !== false));
    this.renderer = this.gpuBoot.renderer;
    installShadowAlphaTwin(this.renderer); // task studio-performance-recorder-20261103 (lane RENDER-CPU): no per-frame shadow re-keying
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = MOOD.exposure;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true; // Iteration 13 (CORE): the atmosphere switches it per quality (flashlight shadow)
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.overlay = new OverlayPass(this.renderer.samples); // Iteration 13 (CORE)
    this.scene.background = new THREE.Color(0x0a0b0c);
    this.scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
    this.scene.add(this.hemi, this.camera, this.muzzleLight, this.fx.group);
    this.scene.add(this.damage.group); // Lane D: debris / craters / damaged props (normal depth-tested scene pass)
    this.damage.prof = this.prof; // task hitch-attribution-recorder-20261105: hit.zombie / hit.tearChunk / hit.extractPatch spans (timing only)
    this.camera.rotation.order = 'YXZ';
    // Hot centre (~10 deg) with a wide soft spill to ~33 deg; low decay so it reaches ~20 m.
    this.flashlight = new THREE.SpotLight(0xfff4e2, 0, 30, 0.58, 0.7, 1.2);
    this.flashlight.position.set(0.2, -0.15, 0.1);
    this.flashlight.target.position.set(0.04, -0.12, -6);
    this.camera.add(this.flashlight, this.flashlight.target);
    // Iteration 13 (CORE): guarded. An atmosphere (render/volumetric.ts TSL pipeline) that cannot be built on this renderer
    // is kept CPU-side only (smoke / scatter API, shadow marking), the station renders directly and the bypass is recorded.
    const atmoLights = {flashlight: this.flashlight, muzzle: this.muzzleLight};
    let atmosphere: VolumetricAtmosphere;
    try {
      atmosphere = new VolumetricAtmosphere(this.renderer as unknown as ConstructorParameters<typeof VolumetricAtmosphere>[0], atmoLights, this.settings.quality);
    } catch (err) {
      this.atmosphereBypass = `atmosphere module unavailable on WebGPURenderer (${String((err as Error)?.message ?? err).slice(0, 200)}); rendering the station directly`;
      console.warn(`Iteration 13: ${this.atmosphereBypass}`);
      atmosphere = new VolumetricAtmosphere(null, atmoLights, this.settings.quality);
    }
    this.atmosphere = atmosphere;
    // Iteration 12 (LIGHT): battery-driven flashlight + warm body glow (always in the scene: the light count never changes);
    // flares get the atmosphere smoke / scatter API, the Sound Lab flare cues and the storey / sight queries.
    this.torch = new PlayerLight(this.flashlight, MOOD.flashlight);
    this.scene.add(this.torch.glow);
    this.flares.env = {
      smoke: this.atmosphere satisfies FlareSmokeHost, audio: this.sfx, // smoke / scatter API: render/volumetric.ts (atmosphere lane)
      levelAt: (x, z, y) => this.levels ? this.levels.levelAt(x, z, y) : 0,
      lineOfSight: (a, b) => !this.levels || this.levels.lineOfSight(a, b),
    };
    // Iteration 14: effects hidden until the first shot / hit and the thrown-flare prototypes are warmed with the station
    this.warmRegistry.addPool('effects', () => [this.fx.group]);
    this.warmRegistry.addPool('flares', () => this.flares.warmPrototypes());
    // task studio-refinement-batch-20261113-035659-01: the crafted grenades — the zombies they hurt / kill, the player a pool burns, the
    // melt system (world/acidMelt.ts) and the scent emitters (ai/scentLure.ts); their canisters / pool film compile with the station
    this.grenades.env = {
      zombies: () => this.zombies, player: () => this.player, smoke: this.atmosphere satisfies FlareSmokeHost, audio: this.sfx,
      kill: (z, dir, point, strength) => this.blastKill(z as unknown as BlightEnemy, dir, point, strength),
      hurt: z => enemyCues(z as unknown as EnemyActor).hurt(this.sfx, z as unknown as EnemyActor),
      playerBurn: () => this.hud.toast('Acid! Get out of the pool', true),
      playerHurt: amount => { this.hud.pain(amount); this.sfx.hurt(); }, // (no direction arc, no camera punch: it burns, it does not hit)
      melt: () => this.acidMelt, scents: () => this.scents, // (world/acidMelt.ts: what the acid may melt; ai/scentLure.ts: the lure's scent)
      levelAt: (x, z, y) => this.levels ? this.levels.levelAt(x, z, y) : 0,
      lineOfSight: (a, b) => !this.levels || this.levels.lineOfSight(a, b),
      noise: (x, y, z) => this.worldNoise(x, y, z, 14, 'impact'),
    };
    this.warmRegistry.addPool('grenades', () => this.grenades.warmPrototypes());
    this.warmRegistry.addPool('shelf-junk-moving', () => this.stock.warmRoots()); // (task studio-food-shelf-production-20261109-002816-01) the moving shelf-junk instanced meshes compile behind the loading screen
    // Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): every moving set of the shelf filler — the authored filler's
    // too, made hidden before each warm-up by refreshRuntimeVariants (world/shelfStockWarm.ts), not on the first shot into a shelf
    this.warmRegistry.addPool('shelf-stock-moving', () => stockMovingSets(this.stock));
    // Task studio-performance-recorder-20261103 (lane RENDER-CPU): the holders' contents hidden until used — the loot display's
    // batches (one InstancedMesh = one node build per item x storey, shown when a lot comes within view distance) and the holders'
    // interiors (shown when opened) — compile with the station instead of on first sight
    this.warmRegistry.addPool('holders', () => (this.containers ? [this.containers.group] : []));
    // Task runtime-variant-warmup-20261105 (render/runtimeVariants.ts): variants that only appear through play — holder takeovers,
    // the aim highlight, damaged parts, flesh chunks — as hidden prototypes built by their real factories (refreshRuntimeVariants)
    this.scene.add(this.runtimeVariants.root);
    this.warmRegistry.addPool('runtime-variants', () => [this.runtimeVariants.root]);
    // task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): the resident new weapons in pickup form (hidden prototypes),
    // so a dropped / found one compiles nothing in play (their held copies are the viewmodel pass's)
    this.scene.add(WEAPON_VARIETY_WARM_GROUP);
    this.warmRegistry.addPool('weapon-variety', () => weaponVarietyWarmRoots());
    // task studio-weapon-runtime-fix-20261110-022206-01: ONE delivery of a new weapon's lazily loaded model, whenever and however it
    // arrives (the section preload, a surface's demand — the Lockbox gear drop, a trade, a restored save —, a retry): the held view,
    // the pickups showing a stand-in, the 3D icons (never while a warm-up owns the renderer); a failed load is said and retried
    this.weaponVariety = installWeaponVarietyDelivery({
      viewmodel: () => this.viewmodel,
      pickups: () => this.pickups,
      syncHeld: () => { if (this.world) this.syncHeld(); },
      refreshIcons: ids => refreshItemIcons(this.renderer, ids),
      rendererFree: () => this.warmRun,
      rendererReady: () => !!this.gpu && this.renderer.initialized === true && !!this.viewmodel,
      say: (text, bad) => this.hud.toast(text, bad),
      itemName: id => itemDef(id).short,
    });
    // (the same task) the open inventory trades a glyph for the rendered preview as soon as it exists (the other item views and the
    // HUD subscribe / key on the icon cache themselves)
    onItemIconsChanged(() => { if (this.state === 'inventory' && !this.invUI.dragging) this.invUI.render(); });
    this.input = new Input(canvas, qa);
    this.input.onLockChange = locked => {
      if (!locked && this.state === 'playing' && !this.qa) this.setState('paused');
    };
    this.input.onKey = code => this.onKey(code);
    this.invUI = new InventoryUI(() => this.inv, {
      use: ref => this.startUse(ref),
      drop: (ref, count) => this.dropRef(ref, count),
      equip: ref => this.equipRef(ref),
      close: () => this.closeInventory(),
      changed: () => this.syncHeld(),
      vitals: () => ({hp: this.player.hp, maxHp: this.player.maxHp, food: this.survival.hunger, water: this.survival.thirst, limbs: injuryStatusHtml(this.injuries)}),
    });
    // Iteration 16 (lane INJURY): hit listener (arm / leg hits) + frame hook (landings, sway -> aimOffset, HUD) + ModifierSource
    // Task frame-budget-deferral-20261030 (lane MEASURE): names the frame hooks each install below registered (profiler spans)
    const hookName = (name: string) => { const n = this.prof.hookNames; while (n.length < this.frameHooks.length) n.push(name); };
    this.injuries = installInjuries(this, {aiming: () => this.aiming});
    hookName('injuries');
    this.gear = installGear(this); // Iteration 16 (lane GEAR): modifier source, key 6 / bag view, E on grounded bags, section hooks, warm-up pool
    hookName('gear');
    // Task gasmask-breach-20261030 (mask lane): after GEAR (wraps its inventory-screen hook); frame hook, input owner, lifecycle, run participant 'gas.mask'
    this.gasMask = installGasMask(this, {cancelUse: reason => this.cancelUse(reason), cancelFlareHold: () => this.cancelFlareHold()});
    this.fuelStations = installFuelStations(this); // task train-fuel-system: realize each campaign station's fuel once; the map's figures
    hookName('gasMask');
    this.fuelPort = installFuelPort(this); hookName('fuelPort'); // task train-fuel-system (lane PORT)
    this.fuelCarts = installFuelCarts(this); // task train-fuel-system (lane CART)
    hookName('fuelCarts');
    this.skywaysCar = installSkywaysCar(this); hookName('skywaysCar'); // task skyways-level-20261106 (lane CAR): its E handler / prompt go first (unshift)
    this.stalls = installStalls(this); // Task office-overhaul-20261030 (lane INTERACT, #13): after GEAR, before TOWER (E-handler order)
    hookName('stalls');
    this.tower = installTower(this); // Iteration 16 (lane TOWER): section hooks, frame hook (doors / collision / exterior), E + prompts, preload, warm-up pool
    hookName('tower');
    this.skywaysWindows = installSkywaysWindows(this); // task studio-skyways-level-20261106-054448 (lane GAS): before GAS (its build reads the panes); inert without layout.skyways
    hookName('skywaysWindows');
    installSkywaysExterior(this); hookName('skywaysExterior'); // (lane VIEW) streets, building shells, bridge exteriors, wrecks, the far city / murk; the glazing's reveal finish; inert elsewhere
    this.skywaysAddon = installSkywaysAddon(this); hookName('skywaysAddon'); // task studio-skyways-level-20261106-054448 (lane ADDON): inert without layout.skyways
    installSkywaysDestinations(this); // task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS): poster / plaque atlases before the build; inert elsewhere
    installSkywaysArchTextures(this); // task studio-skyways-rework-20261107-054512-01 (lane ARCH): the courts' / bridges' Codex textures before the build (layout v3); inert elsewhere
    installMarketTextures(this); // task studio-survivor-market-20261108-005807-01 (lane LEVEL): the market's Codex surface textures before the build; inert elsewhere
    installMarketVisuals(this); hookName('marketVisuals'); // (lane LEVEL) the market's slow ceiling fans (frame hook) and stall awnings; inert elsewhere
    installSkywaysMapRead(this); hookName('skywaysMapRead'); // task studio-skyways-rework-20261107-054512-01 (lane MAPS): E at a directory board reads its face (inert without boards)
    installSubwayMapRead(this); hookName('subwayMapRead'); // task studio-ui-subway-maps-20261108-074144-01: E at a Subway station map kiosk reads its face (inert without kiosks)
    installSkywaysDestAudio(this); // task skyways-destinations-20261106 (lane AUDIO): clock tick / chime, arcade attract, cinema projector emitters per section (inert elsewhere)
    installOfficeAtmosphere(this); // Task office-overhaul-20261030 (lane ARCH): office wall / carpet / ceiling textures before the build; roof = outdoor green fog
    installMallAtmosphere(this); // Task track3-eaton-centre-20261031 (lane ARCH): mall = light dusty haze, raised far plane, culler fog distance (inert elsewhere)
    hookName('officeAtmosphere');
    installReactorArch(this); hookName('reactorArch'); // task reactor-build-20261101 (lane ARCH): Reactor textures preload, model keys, deep haze / far plane / culler distance, kit visuals tick (inert elsewhere)
    installReactorCoreLights(this); hookName('reactorCoreLights'); // task reactor-expansion-20261101 (lane CORE): the reactor's green / blue glow lights (boot-time, intensity-only; inert elsewhere)
    this.gas = installGas(this); // Task gasmask-breach-20261030 (lane GAS): after TOWER (its build reads the windows) — bullet hits, frame hook, section hooks
    hookName('gas');
    this.gas.windowSources.push(() => this.skywaysWindows.gasSource()); // (lane GAS, Skyways) the glazing's panes when the world has no office tower
    this.gas.zoneSources.push(bunkerGasSource); // task studio-bunker-level-20261109-072224-01: the Bunker's gas zones (visible green fog + exposure, one field)
    // Task gasmask-breach-20261030 (primary): breach gas spares the player only behind a mask that is on with a working filter.
    // The mask's frame hook runs first (installed earlier), so a filter swapped in this frame already counts.
    this.gas.protection = () => this.gasMask.protects();
    this.gas.hintFor = protectedNow => {
      const m = this.gasMask;
      if (protectedNow || m.state === 'donning') return '';
      if (!m.worn) return 'No gas mask — get out of the gas';
      return m.on ? 'No filter — the mask is not protecting you' : 'Put on your gas mask (Q)';
    };
    this.cough = installCough(this); // after GAS: its frame hook reads this frame's exposure
    hookName('cough');
    installReactorAir(this); hookName('reactorAir'); // task reactor-build-20261101 (lane AIR): after GAS (sets gas.depth on its build) — Reactor depth gas, generators (hold E), fans, HUD air line; inert elsewhere
    // Task track1-siren-blightbelly-20261031 (lane BLIGHT): after GAS (bursts add gas puffs); frame hook + section hooks. The lazy
    // enemy models (ai/enemyModels.ts) are fetched per layout through propModels like the office models.
    this.blight = installBlightBurst(this, {rand: () => this.rand()});
    hookName('blight');
    this.sectionModelKeys.push(enemyModelKeysFor);
    this.sirens = installSirens(this); // Task track1-siren-blightbelly-20261031 (lane SIREN): frame hook (wake memory, vein fades), section teardown, warm pool 'siren-veins'
    hookName('sirens');
    installReactorRestart(this); hookName('reactorRestart');
    installReactorStartup(this); hookName('reactorStartup'); // task reactor-playtest-round2-20261102 (lane STARTUP): after RESTART (reads its record / hold / win clock) — the startup audio director, the orange rotating beacons + their boot-time SpotLights, the blue beam + its boot-time PointLights, the sky over the roof clearing; inert elsewhere
    installReactorSurface(this); hookName('reactorSurface'); // task studio-reactor-surface-ending-20261102 (lane SURFACE): after STARTUP (reads its ONLINE sky) — the ruined city, rain, clear sky / mist round the roof aperture, shown only with the eye outside; inert elsewhere
    installReactorEnding(this); hookName('reactorEnding'); // task studio-reactor-surface-ending-20261102 (lane ENDING): after RESTART / AIR (reads their live state; its objective stage) — the sealed exterior door, its opening once the core air cleared, the centre "External doors open" message docking into the objective, the parapet ring round the opening; inert elsewhere
    // task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CREDITS): after ENDING (reads its live surfaced phase /
    // message) — 10 s of active play on the surface -> the slow top-right credits -> "Thank you for playing" + Main Menu (commitEndingSave,
    // returnToMenu); its own lane store 'reactor.credits'; inert elsewhere
    installReactorCredits(this); hookName('reactorCredits');
    installReactorCpuCulling(this); hookName('reactorCpuCulling'); // task studio-reactor-submit-roof-fog-20261102 (lane CPU): enemies / pickups behind the Reactor's rock decided by the level culler (inert elsewhere)
    installReactorMapBoards(this); hookName('reactorMapBoards'); // task reactor-expansion-20261101 (lane CONTROLS): floor-map boards beside the instruction boards (X marks, storey buttons; inert off the Reactor) // task reactor-build-20261101 (lane RESTART): E / hold-E controls, prompts, screens, the win sequence, section hooks (inert off the Reactor)
    installBunkerObjective(this); hookName('bunkerObjective'); // task studio-bunker-level-20261109-072224-01 (lane OBJECTIVE): fuel + turnkey-start the three auxiliary generators, core map intel once per station (lane 'bunker.state'; inert off the Bunker)
    // Task player-train-shell-20261101-202805 (lane TRAIN): LAST (its build rebuilds game.propIndex over everything already there, after the
    // stalls; its E handler / prompt come after the others): section hooks (the car at game.trainPlacement, interior volume + colliders, built
    // synchronously before the first update), frame hook (doors), E + prompt, the boot-time head / tail / interior lights, warm pool
    this.trainRuntime = installPlayerTrain(this, {models: () => trainModelsFrom(this.propModels), textures: () => loadTrainTextures()});
    hookName('train');
    this.lockbox = installLockbox(this); // task train-lockbox-windows-20261101-232156 (lane BOX): after TRAIN (its onLockboxInteract opens the view)
    hookName('lockbox');
    // task studio-survivor-market-20261108-005807-01 (lane TRADE): the market stalls' trade view (E at a stall's front; inert where the layout
    // has no market); run participant 'market.wallet' now only settles an old save's balance into physical Rail Ties, once
    this.trade = installMarketTrade(this);
    hookName('marketTrade');
    // task studio-market-rework-20261108-074144-01 (lane WARES): AFTER the trade (its build reads the trade's stock) — every stall's real stock
    // as owned world items on its display surfaces; its E / prompt go first (unshift): aimed at a ware, a red Steal (inert without a market)
    this.marketWares = installMarketWares(this);
    hookName('marketWares');
    // (lane HUMANS) the market's friendly people — traders at their stalls, residents wandering between the market's spots; their own list
    // (never game.zombies: not hit, counted, alerted or carried); spawned in the section build (before the warm-up); inert elsewhere
    this.marketPeople = installMarketPeople(this);
    hookName('marketPeople');
    this.trade.onTalk = id => this.marketPeople.onTalk(id); // the trader greets the customer who opens its stall
    // task studio-market-rework-20261108-074144-01 (lane COMBAT): after the people (its section build reads them; its frame drives them once
    // hostile) — their hit volumes for fire() / meleeContact(), the settlement's hostility (Game.marketHostility), the hostile survivors'
    // gunfire through gunshotPlayer; the lane store 'market.hostility'; inert where the layout has no market
    this.marketCombat = installMarketCombat(this);
    this.marketHostility = this.marketCombat;
    hookName('marketCombat');
    // task studio-market-bar-20261108-225231-01 (lane AUDIO): after the people / combat (its section build and frame read them) — the market's
    // sounds (Game.marketAudio, market/marketAudio.ts): the trade's register cue, the calm crowd's murmur, the fleers' screams / fighters'
    // grunts (the people call them), the player's retch; inert without a market (the retch / register play wherever they are called)
    this.marketAudio = installMarketAudio(this);
    hookName('marketAudio');
    // task studio-market-bar-20261108-225231-01 (lane SHELVES): the throw-up action (Game.vomit: body / camera / held item, the food chunks —
    // a physics body source —, the retch); its frame hook runs after the player's step and before the camera; inert until start()
    this.vomit = this.vomitAction = installVomit(this);
    hookName('vomit');
    // task studio-market-bar-20261108-225231-01 (lane BEER): Game.beerEffects — the one timed beer (frame hook: active play only; run participant
    // 'market.beer'; the Lager's ModifierSource), the Bock's overfill, the Pilsner's acquisition hook (market/beer/beerEffects.ts)
    installBeerEffects(this);
    hookName('beerEffects');
    installSkywaysTrunk(this); hookName('skywaysTrunk'); // task studio-beta-skyways-vehicle-20261107 (lane TRUNK): after the car (its section hook follows the car's) and the Lockbox; inert without the car
    // task campaign-foundation-20261102 (lane RIDE): the moving train — no frame hook (update() calls it in the player's slot), the
    // transit tunnel (built on the first section build, warm pool 'train-transit'), the gear's no-set-down-while-moving rule
    // (the jostle intensity = the player's Train sway setting 0..1; 0 = off)
    // task studio-perf-ao-train-continuity-20261110-022206-01: the ride portals of the parked car's track (before the ride, which drives them)
    this.ridePortals = installRidePortals(this);
    hookName('ridePortals');
    this.trainRide = installTrainRide(this, this.trainRuntime, {jostle: () => this.settings.trainSway});
    this.trainRuntime.onConsoleInteract = () => { this.openTravelMap(); }; // (campaign, primary) the driving console opens the paper map
    // task train-loose-cargo: the train's loose items / bags travel with it (after the gear, train, ride and fuel carts: its section teardown
    // runs FIRST — unshifted — and its build LAST)
    this.trainCargo = installTrainCargo(this);
    hookName('trainCargo');
    // task studio-beta-train-all-cargo-20261107-184244-01: the movable props aboard travel too (after the item cargo: its teardown runs first
    // — unshifted —, its holders hook after the fuel holders', its build last, after the train's floor colliders)
    this.trainPropCargo = installTrainPropCargo(this);
    hookName('trainPropCargo');
    // task studio-corpse-chipper-fuel-20261110-235304-01 (lane CORPSE): after the cargo systems (teardown first — unshifted —, build last); its
    // E / prompt while carrying go first (unshift), the pickup's after every lane's; the train chipper registers its sink (addSink)
    this.corpses = installCorpses(this, {enemyIndex: z => this.enemyIndex.get(z), forgetEnemy: z => { this.enemyIndex.delete(z); }, cancelUse: r => this.cancelUse(r), targets: () => ({pickup: this.currentTarget, container: this.containerTarget})});
    hookName('corpses');
    // task studio-corpse-chipper-fuel-20261110-235304-01 (lane CHIPPER): after the train, ride and cargo (its section build attaches to the car's
    // view; its teardown keeps a riding car's machine) — the corpse sink, the grind / transfer / blood / noise, the look-at line, warm pool 'train-chipper'
    this.chipper = installChipper(this);
    // task studio-corpse-market-shop-20261114-031614-01: after the corpses (its sink) and the market's people / combat (it reads the hostility) — the Market den's
    // corpse buyer: the chute sink, the sale clock on the station lane 'market.corpse-shop', the physical Rail Ties drop; inert without a den
    this.corpseShop = installCorpseShop(this);
    hookName('corpseShop');
    hookName('chipper');
    // task studio-train-crafting-v1-20261111-225628-01: after the train, the ride, the fuel carts and the cargo systems — the crafted
    // equipment (lane EQUIP: kinematic units on the fuel dolly's controller, the plugs, its own cargo capture / station lane; the train
    // record's live hook), then the systems that read it: the bench (lane BENCH), the sentry (lane SENTRY), the scanner (lane SCANNER)
    this.trainEquipment = installTrainEquipment(this, {cancelUse: r => this.cancelUse(r)});
    hookName('trainEquipment');
    this.craftBench = installCraftBench(this, {pickupTarget: () => this.currentTarget, // (a loose item under the crosshair wins [E] over the bench)
      // task train-interaction-ux-20261112-063646 (lane CRAFT-UI): the recipe rows' 3D previews go through the inventory's icon pass
      refreshIcons: ids => refreshItemIcons(this.renderer, ids), rendererReady: () => !!this.gpu && this.renderer.initialized === true, rendererFree: () => this.warmRun});
    hookName('craftBench');
    this.sentryTurret = installSentryTurret(this, {rand: () => this.rand()}); // (its spread draws from the level's own random stream)
    hookName('sentryTurret');
    this.itemScanner = installItemScanner(this);
    hookName('itemScanner');
    // task studio-refinement-batch-20261113-035659-01 (lane SAVE): after the train and the ride — the Save terminal left of the desk (its aim /
    // glow / prompt / [E] through the train's own aim: PlayerTrainRuntime.saveTerminal; the screen's frame hook; the CRT model with the car)
    this.saveTerminal = installSaveTerminal(this);
    hookName('saveTerminal');
    // task studio-refinement-batch-20261113-035659-01 (lane ARMOR): after the train and the ride (its section build reads the built car;
    // the car's own build reads the fitted boxes) — the armour kit on the car's view, its parked / riding colliders, the zombies-only contact
    // damage (a frame hook: after updateZombies), warm pool 'train-armor', the recipe row's preview 'upgrade:armor' through the icon pass
    this.trainArmor = installTrainArmor(this, {refreshIcons: ids => refreshItemIcons(this.renderer, ids),
      rendererReady: () => !!this.gpu && this.renderer.initialized === true, rendererFree: () => this.warmRun});
    this.trainUpgrades = this.trainArmor;
    hookName('trainArmor');
    // task studio-first-player-onboarding-20261111-234657-01: after the train / chipper (its section build reads the placed console desk) —
    // seven world-space markers at the parked train until the player first walks 10 m from it (world/trainOnboarding.ts); warm pool
    // 'train-onboarding'; nothing collides, casts or takes [E]
    this.onboarding = new OnboardingStore(browserOnboardingStorage());
    this.trainOnboarding = installTrainOnboarding(this, this.onboarding);
    hookName('trainOnboarding');
    // (keep it the LAST install that unshifts a section hook: its teardown must run FIRST — a melt in progress completes, spilling into the
    // pickups / cargo / bodies the later teardowns then record; world/acidMelt.ts install)
    installAcidMelt(this); // task studio-refinement-batch-20261113-035659-01 (lane MELT): sets this.acidMelt; its own layout / section / frame hooks, warm pool 'acid-melt'
    hookName('acidMelt');
    this.sectionModelKeys.push(playerTrainModelKeys);
    this.sectionModelKeys.push(skywaysKitchenModelKeysFor); // task studio-skyways-level-20261106-054448 (lane FOOD): the ramen restaurant's skyways-* models
    this.sectionModelKeys.push(skywaysAddonModelKeysFor); // task studio-skyways-level-20261106-054448 (lane ADDON): the add-on's skyways-* models
    this.sectionModelKeys.push(skywaysDestModelKeysFor); // task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS): the destinations' skyways-d-* models
    this.sectionModelKeys.push(skywaysGardenModelKeysFor); // (task studio-skyways-rework-20261107-054512-01, lane ARCH) the planters' foliage (the office potted plant)
    this.sectionPreloads.push(layout => preloadOfficeAssets(layout, {models: false})); // Iteration 16 (WORLD-GEN): office textures before the build (models come via propModels)
    void preloadMedicalModels(); // fetched with the main assets; load() awaits it before item templates / icons
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => { if (this.state === 'playing' && !this.qa) this.setState('paused'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.setState('paused'); });
    this.resize();
  }

  /** Iteration 13 (CORE): called once when the GPU device / WebGL context is lost (main.ts shows the error overlay). */
  onDeviceLost: ((text: string) => void) | null = null;

  /**
   * Iteration 13 (CORE): `await renderer.init()` (WebGPU adapter + device, or the WebGL 2 fallback), then record what actually
   * runs (game.gpu, read from the backend object), hook device-lost / GPU-error reporting and the software-rasterizer
   * anisotropy cap. Idempotent: every caller gets the same promise; rejects only when neither backend starts.
   */
  initRenderer(): Promise<GpuInfo> {
    this.gpuInit ??= this.renderer.init().then(() => {
      const gpu = describeBackend(this.renderer.backend as never, this.gpuBoot.request, this.gpuBoot.fallbackError());
      this.gpu = gpu;
      watchDevice(this.renderer, gpu, {onLost: text => { this.lastError = text; this.journeyCompile?.cancel(); this.onDeviceLost?.(text); }});
      this.softwareGl = adaptToSoftwareGl(this.renderer); // iteration 08: no anisotropic filtering on software rasterizers / adapters
      observeBackendAnisotropy(this.renderer.backend); // lane FIX (U08): count the anisotropy values the backend hands the API (__LL.anisotropy())
      installFlareLightNode(this.renderer); // Iteration 15: flare lights occluded by their window (before the first compile)
      installUploadDedupe(this.renderer); // task mall-horde-performance-20261105: no identical / split per-frame uniform uploads (WebGPU only)
      this.overlay.target.samples = this.renderer.samples; // 0 in WebGPU compatibility mode
      console.info(`Terminal State: ${gpu.label}${gpu.adapter ? ` · ${[gpu.adapter.vendor, gpu.adapter.architecture, gpu.adapter.description].filter(Boolean).join(' ')}` : gpu.glRenderer ? ` · ${gpu.glRenderer}` : ''}`);
      return gpu;
    });
    return this.gpuInit;
  }

  /** First-person consume animation (weapons/consumeView.ts); visual only, `use` stays authoritative. */
  consumeView!: ConsumeView;

  // ---------------------------------------------------------------------------------------
  async load(onProgress: (f: number, label: string) => void): Promise<void> {
    this.assets = await loadAssets(onProgress);
    const m = this.assets.models;
    for (const g of Object.values(m)) g.scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) this.sharedGeometries.add(mesh.geometry); });
    // Task track3-eaton-centre-20261031 (lane PERF): record the boot models' texture uploads (a recorder only; the item icons below
    // upload many of them) so the mall can release their decoded images (assets/textureRelease.ts)
    for (const g of Object.values(m)) trackUploads(modelTextures(g));
    const lb = new THREE.Box3().setFromObject(m.light.scene).getSize(new THREE.Vector3());
    this.mats = new WorldMaterials(this.assets.textures, 20261025, {w: lb.x, h: lb.y, d: lb.z});
    // Food/drink use the generated item models when the manifest has them (else stand-ins).
    await preloadMedicalModels(); // Iteration 16 (lane INJURY): Meshy splint / sling (null urls / failures -> authored models)
    await preloadReactorItemModels(); // task reactor-build-20261101 (lane RESTART): startup key / fuse cartridge kit GLBs (failures -> procedural stand-ins)
    await preloadFuelCanModel(); // task train-fuel-system (lane PORT): the fuel-can GLB before item templates / icons (a failure -> the fallback box)
    await preloadGrenadeModels(); // task studio-refinement-batch-20261113-035659-01: the acid / lure grenade GLBs (a failure -> the fallback cylinder)
    await preloadBeerLabels(); // task studio-market-bar-20261108-225231-01 (lane BEER): the beer bottles' Codex label atlas (a failure -> plain paper labels)
    registerItemModels(m as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF | undefined>);
    const consumables: Record<string, THREE.Object3D> = {};
    for (const id of Object.values(ITEMS).filter(d => d.kind === 'consumable' || d.kind === 'throwable').map(d => d.id)) {
      const o = makeSupplyMesh(id);
      // Iteration 12 (LIGHT): a held flare is gripped mid-tube, cap (head) pointing forward and a little up
      // (task studio-refinement-batch-20261113-035659-01: the upright acid / lure canisters are held like a can, cap up)
      if (itemDef(id).kind === 'throwable' && !isGrenadeItem(id)) o.rotation.set(0.35, Math.PI / 2 + 0.12, 0.1); else o.rotation.set(0.5, -0.4, 0.15);
      o.traverse(x => { const mm = x as THREE.Mesh; if (mm.isMesh) mm.frustumCulled = false; });
      consumables[id] = o;
    }
    // Pistol lane: the user's real pistol.glb (PISTOL_ART_READY), like the rifle/shotgun: viewmodel, item icon and pickups.
    // The dev placeholder is only reachable if the gate were off (pre-art staging with ?devpistol=1); never with the real model.
    const pistolGltf = PISTOL_ART_READY ? m.pistol
      : this.devPistol ? ({scene: makePistolDevPlaceholder()} as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF) : undefined;
    // Lane KNIFE (knife-melee-20261030): the user's knife joins the held models (viewmodel, item icon, dropped pickup).
    const guns = {rifle: m.rifle, shotgun: m.shotgun, ...(pistolGltf ? {pistol: pistolGltf} : {}), ...(m.knife ? {knife: m.knife} : {})};
    this.viewmodel = new Viewmodel(guns, consumables);
    // Lane D (iteration 04): eat/drink/apply with the real item model in hand, and inventory icons
    // rendered once from the runtime models through this renderer (ui/itemIcons.ts).
    this.consumeView = new ConsumeView(this.viewmodel, makeSupplyMesh);
    // Iteration 14: the viewmodel overlay is its own render pass (own scene / camera / target): every held item and the
    // muzzle flash compile there on the loading screen
    const vm = this.viewmodel;
    this.warmRegistry.addPass({name: 'weapons and held items', scene: vm.scene, camera: vm.camera, target: () => this.overlay.target, hidden: () => vm.warmRoots()});
    // Task gas-mask-roof-feedback-20261030 (item 4): the first-person gas-mask view — a viewmodel derivative of the real outfit mask
    // (gear/maskView.ts), fixed to the face in this overlay pass; one of vm.warmRoots(), so it compiles with the held items.
    this.gasMask.attachView(new MaskView(m.outfit_gasmask), vm, () => vm.aimBlend);
    await this.initRenderer(); // Iteration 13 (CORE): the icon renders are the first GPU work (init overlapped the download)
    await buildItemIcons(this.renderer, guns); // a pistol without a model keeps its SVG icon (ui/icons.ts)
    this.pickups = new PickupManager(guns);
    this.scene.add(this.pickups.group);
    // task studio-weapon-runtime-fix-20261110-022206-01: a stand-in pickup that got its real model has a new size (physics bounds);
    // the held view asks for a missing weapon model, and gets every model that is already resident
    this.pickups.onReskin = p => this.physics?.dynamicItems.pickupReskinned(p);
    this.weaponVariety.attach();
    this.resize();
  }

  get seed(): number {
    return this.currentSeed;
  }

  // ==== Iteration 16 (lane RUN): sections, travel and run carryover =====================================================
  // A RUN lasts from NewGame to the next NewGame. Travel (elevator / stair door / pause-menu level change) moves the SAME
  // live player state (inventory with gear and backpack contents, hp / stamina, hunger / thirst, battery, injuries) to
  // another section; only NewGame resets it, and Retry level restores the snapshot taken when the level was entered.

  /** Generate a section of `run` (levels/registry.ts; the section's gear from the run's level-wide roll). Deterministic. */
  generateSection(key: SectionKey, run: RunState = this.run): StationLayout {
    this.lifecycleCounts.generate++;
    // (task studio-skyways-destinations-20261106-170011-01) a Skyways station regenerates with the layout version it was first built with
    // (task studio-market-rework-20261108-074144-01, lane LAYOUT) so does a Survivor Market: a market entered under the first market's
    // build keeps version 1 forever, an unvisited / new one builds the container settlement (gen/market/layoutVersion.ts)
    // (task studio-bunker-level-20261109-072224-01, lane LEVEL) and a Bunker: version 1 from its first release (gen/bunker/layoutVersion.ts)
    const versionLane = key.level === 'skyways' ? SKYWAYS_LAYOUT_LANE : key.level === 'market' ? MARKET_LAYOUT_LANE : key.level === 'bunker' ? BUNKER_LAYOUT_LANE : null;
    const {layoutVersion, ctx} = this.sectionGenInputs(key, run);
    // (campaign: the node's own seed; lane BUILD: a journey's destination comes pre-generated from the same inputs — takePregenerated)
    const layout = this.takePregenerated(key, run, ctx) ?? LEVELS[key.level].generate(key.section, ctx);
    if (layoutVersion !== undefined && versionLane && run.laneStore(versionLane, key) === undefined) run.setLaneStore(versionLane, {v: layoutVersion}, key);
    // (task studio-screacher-production-20261110-221858-01) every level: the enemy-roster version this station was first built with
    // (ai/enemyRoster.ts: a station visited before the roster existed stays at 0 — its enemies and kills exact; an unvisited one gets the current)
    if (run.laneStore(ROSTER_LANE, key) === undefined) run.setLaneStore(ROSTER_LANE, {v: ctx.rosterVersion ?? 0}, key);
    const node = key.station ? run.node(key.station) : null;
    if (node) adoptStationName(layout, node.name); // campaign: the map's / save's name is the one on the signs and the HUD
    return layout;
  }

  /** generateSection's generator inputs for `key` of `run` (the layout version of a versioned level, see above; lane BUILD: + the journey's pre-generation). */
  private sectionGenInputs(key: SectionKey, run: RunState): {layoutVersion: number | undefined; ctx: SectionGenContext} {
    const layoutVersion = key.level === 'skyways' ? skywaysLayoutVersionFor(run.peekMemory(key)) : key.level === 'market' ? marketLayoutVersionFor(run.peekMemory(key)) : key.level === 'bunker' ? bunkerLayoutVersionFor(run.peekMemory(key)) : undefined;
    return {layoutVersion, ctx: {levelSeed: run.seedFor(key), startWeapon: this.startWeapon, gear: run.gearFor(key), ...(layoutVersion !== undefined ? {layoutVersion} : {}),
      rosterVersion: rosterVersionFor(run.peekMemory(key))}}; // (the seeded enemy roster: always explicit — levels/types.ts SectionGenContext.rosterVersion)
  }

  /**
   * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): a journey's destination layout, generated when the destination
   * is CONFIRMED (travelToStation, before the car departs). The layout generator is one deep synchronous algorithm the paced build cannot
   * slice: a one-off block at the click (the travel map closing) instead of frozen frames in the moving ride. generateSection takes it in
   * place of generating again only when the run, the section and every generator input still match (else it generates as before; it is
   * dropped either way), so its lane-store write and the station name stay at prepare time and the layout is the one the old path made.
   */
  private pregenerated: {run: RunState; key: string; inputs: string; layout: StationLayout} | null = null;

  private pregenerateSection(key: SectionKey, run: RunState): void {
    this.pregenerated = null;
    try {
      const {ctx} = this.sectionGenInputs(key, run);
      this.pregenerated = {run, key: `${key.level}/${sectionId(key)}`, inputs: JSON.stringify(ctx), layout: LEVELS[key.level].generate(key.section, ctx)};
    } catch (err) { console.warn('journey: pre-generating', key, 'failed (the prepare generates it again)', err); }
  }

  /** The pre-generated layout when it was made for exactly this run, section and inputs (taken once; null otherwise). */
  private takePregenerated(key: SectionKey, run: RunState, ctx: SectionGenContext): StationLayout | null {
    const p = this.pregenerated;
    this.pregenerated = null;
    return p && p.run === run && p.key === `${key.level}/${sectionId(key)}` && p.inputs === JSON.stringify(ctx) ? p.layout : null;
  }

  /**
   * Iteration 07 (Lane P2) / 16: generates a section and fetches exactly the lazy prop models it placed (plus the lanes'
   * section preloads) BEFORE it is built and revealed. Cached models resolve at once; a model that fails is dropped from
   * the section, never boxed.
   */
  async prepareSection(key: SectionKey, run: RunState = this.run, onProgress?: (frac: number, label: string) => void): Promise<StationLayout> {
    this.lifecycleCounts.prepare++;
    this.propModels.sealed = this.levelResources.sealed = false; // lane PACKAGE (track3): the loading screen fetches the level's assets
    this.levelResources.beginSection(); // (task train-all-cargo: a carried prop's art, whatever its level, stays with this section)
    const layout = this.generateSection(key, run);
    for (const f of this.sectionLayoutHooks) { try { f(layout, key, run, 'prepare'); } catch (err) { console.warn('train-all-cargo: a layout hook failed', err); } }
    const lazyKeys = this.modelKeysFor(layout, key.level);
    await this.propModels.ensure(lazyKeys, onProgress);
    for (const k of lazyKeys) { const g = this.propModels.get(k); if (g) trackUploads(modelTextures(g)); } // (lane PERF, track3) upload recorder only
    for (const pre of this.sectionPreloads) {
      try { await pre(layout); } catch (err) { console.warn('Iteration 16: a section preload failed', err); }
    }
    await this.preparePantry(key, run); // task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): the pantry models this section can show
    await this.prepareWeaponVariety(layout, key, run); // task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): the new weapons it can show
    return layout;
  }

  /**
   * Task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): fetch (behind the loading screen) the new weapons' models this
   * section can show — what its first spawn realizes (items/weaponVariety.ts), what its memory holds and everything the player carries
   * (inventory, Lockbox, train cargo). `late` (after a build: a save's carried items, installed after the prepare): no first-spawn plan
   * (the build has realized it), counted as a late fetch.
   * Task studio-weapon-runtime-fix-20261110-022206-01: this is the PRELOAD only (so a station's finds and the carried weapons are there
   * before play). Handing a model to the held view, the pickups and the icons is the delivery's (world/weaponVarietyDelivery.ts), for
   * whatever arrives by any path — and a weapon that turns up mid-play is asked for by the surface that shows it. The previews are
   * awaited here, so they are rendered before the station is revealed.
   */
  private async prepareWeaponVariety(layout: StationLayout | null, key: SectionKey | null, run: RunState = this.run, late = false): Promise<void> {
    try {
      const mem = key ? run.peekMemory(key) ?? null : null;
      const ids = varietyIdsIn([this.inv.toJSON(), this.playerTrain.lockbox.toJSON(), this.playerTrain.cargo.toJSON(), mem]);
      if (layout && key && !late && !mem?.pickups) for (const id of plannedVarietyIds(layout, key.level, mem?.id ?? sectionId(key), {pool: sectionWeaponPool(mem?.lanes, mem?.visits ?? 0)})) ids.add(id); // (before the entry: visits = earlier entries)
      await ensureWeaponVarietyModels(ids, {late});
      if (!late) await this.weaponVariety.settled();
    } catch (err) { console.warn('weapon variety: model preparation failed', err); }
  }

  /**
   * Task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): fetch (behind the loading screen) the pantry food / drink models
   * `key` can show — its level's palette (items/pantryVariety.ts levelPreloadPantryIds), the pantry items in its memory and everything the player
   * carries (inventory, Lockbox, train cargo) — and refresh what already showed a fallback (templates, held copies, icons). Resident
   * models stay (world/pantryModels.ts). `late`: after a build (a save's carried items): only the carried set.
   */
  private async preparePantry(key: SectionKey | null, run: RunState = this.run, late = false): Promise<void> {
    try {
      const ids = pantryIdsIn([this.inv.toJSON(), this.playerTrain.lockbox.toJSON(), this.playerTrain.cargo.toJSON(), key ? run.peekMemory(key) ?? null : null]);
      if (key && !late) for (const id of levelPreloadPantryIds(key.level)) ids.add(id);
      const fresh = await ensurePantryModels(ids, {late});
      if (!fresh.length) return;
      refreshItemTemplates(fresh);
      for (const id of fresh) {
        if (this.use?.itemId === id) continue; // (a late load mid-use keeps the copy in the hand)
        const o = makeSupplyMesh(id);
        o.rotation.set(0.5, -0.4, 0.15); // (Game.load's consumable hand pose)
        this.viewmodel?.addHeldItem(id, o, {hip: [0.16, -0.17, -0.36], yaw: 0.05, roll: -0.04});
      }
      if (this.world) this.syncHeld();
      if (this.gpuInit) await refreshItemIcons(this.renderer, fresh);
    } catch (err) { console.warn('pantry food: model preparation failed', err); }
  }

  /** Iteration 16: every lazy model key a section uses (p7 props + lane keys, e.g. office models). */
  private modelKeysFor(layout: StationLayout, level: LevelId): string[] {
    // task train-all-cargo: CARRIED props (placement.cargo: the train's, or left in this station) bring their own models whatever their
    // level (a mall cafe chair in the Subway's train): the generated placements under the level rule, the carried ones' keys as well
    const carried = layout.props.filter(p => p.cargo);
    const own = carried.length ? {...layout, props: layout.props.filter(p => !p.cargo)} : layout;
    // Task track3-eaton-centre-20261031 (lane PACKAGE): another level's own art (assets/levelAssets.ts, e.g. mall-*.glb outside the
    // mall) is never fetched or kept for this level
    const sel = selectLevelKeys(level, this.layoutModelKeys(own), this.propModels.catalogue);
    if (sel.foreign.length) console.warn(`Level ${level} asked for another level's models (skipped): ${sel.foreign.join(', ')}`);
    return carried.length ? [...new Set([...sel.keys, ...this.carriedModelKeys(layout, carried)])] : sel.keys;
  }

  private layoutModelKeys(layout: StationLayout): string[] {
    const extra = this.sectionModelKeys.flatMap(f => { try { return [...f(layout)]; } catch (err) { console.warn('Iteration 16: section model keys failed', err); return []; } });
    return [...new Set([...p7ModelKeysFor(layout), ...extra])];
  }

  /** Task train-all-cargo: the lazy model keys carried placements add (world/trainPropCargo.ts carriedModelKeys). */
  private carriedModelKeys(layout: StationLayout, carried: readonly PropPlacement[]): string[] {
    return carriedModelKeys(l => this.layoutModelKeys(l), layout, carried);
  }

  /** Task train-all-cargo: are the lazy models these carried placements need resident (a fetch that failed: they wait as records)? */
  carriedModelsReady(layout: StationLayout, props: readonly PropPlacement[]): boolean {
    const cat = this.propModels.catalogue;
    return this.carriedModelKeys(layout, props).every(k => !cat[k] || this.propModels.has(k));
  }

  /** Lane PACKAGE (track3): the current level's lazy working set / resident set (QA `__LL.levelAssets()`). */
  levelAssetsQa() {
    if (!this.layout) return null;
    const level = this.run.current.level;
    return {level, workingSet: levelWorkingSet(level, this.modelKeysFor(this.layout, level), this.propModels.catalogue),
      resident: {models: this.propModels.loadedKeys().length, bytes: this.propModels.residentBytes(),
        foreign: this.propModels.loadedKeys().filter(foreignTo(level, this.propModels.catalogue))}, // another level's own art still resident: should be []
      library: {...this.propModels.stats},
      levelResources: {summary: this.levelResources.summary(), stats: {...this.levelResources.stats}},
      // Task track3-eaton-centre-20261031 (lane PERF): mall lazy-model decoded images released after upload; shared instancing programs
      perf: {cpuCopies: {...textureReleaseStats}, attributeInstancing: attributeInstancing()}};
  }

  /**
   * Iteration 16: tear the live section down. Lane hooks first (run.current is still this section and its world is alive:
   * lanes save their section data), then — on a travel — RUN's memory of it, then the world itself.
   */
  private leaveSection(save: boolean): void {
    this.lifecycleCounts.leave++;
    this.stationGen++; // Iteration 14: invalidates a warm-up of the previous station
    this.frameBudget.bumpGeneration(); // lane SCHED: the old world's queued background jobs are cancelled (never run against the next one)
    // Iteration 14 (user: "when I load a new station the stutters come back"): three r186 frees a node build / pipeline /
    // program when its LAST user is disposed, and the next station needs the same ones (zombie + wound materials, glow,
    // instanced variants). The old station leaves the scene now; its GPU releases are queued and run only after the new
    // station's warm-up re-used those programs (prepareGraphics), instead of rebuilding them at the start of the level.
    this.flushRetired(); // anything still queued from an earlier station
    if (this.world) for (const h of this.sectionHooks) h.teardown?.(); // Iteration 16: lane section state (elevator, grounded bags, …)
    if (this.world && save) this.saveSectionMemory();
    if (this.world) {
      const oldGroup = this.world.group;
      this.scene.remove(oldGroup);
      // Track 2 round 2 (lane MOTION): the annex machinery's own release (merged geometries, the fan-rotor InstancedMesh), queued
      // with the other world releases (its shared materials stay cached for the next level's build)
      const machines = this.world.trackExt?.machines;
      if (machines) this.retire(() => machines.dispose());
      const instanced: THREE.InstancedMesh[] = [];
      oldGroup.traverse(o => {
        const mesh = o as THREE.Mesh;
        if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh);
        // geometry buffers go now (a geometry dispose never releases three's node builds / pipelines)
        if (mesh.isMesh && !this.sharedGeometries.has(mesh.geometry) && !this.propModels.ownsGeometry(mesh.geometry)) mesh.geometry.dispose();
      });
      this.retire(() => { for (const im of instanced) im.dispose(); }); // the object 'dispose' event frees its render objects
      this.lightPool.dispose(this.scene, fn => this.retire(fn));
    }
    for (const z of this.zombies) { this.scene.remove(z.root); const old = z; this.retire(() => old.dispose()); }
    this.zombies = [];
    this.screacherBrains.length = 0;
    this.enemyIndex.clear();
    this.hordes = null; // lane HORDE: the director belongs to the torn-down world
    this.chaseShare = null;
    this.pickups.clear();
    this.layoutPickup.clear();
    this.runtimeVariants.clear(fn => this.retire(fn)); // task runtime-variant-warmup-20261105: the old world's prototypes go with it
    this.containers?.clear();
    this.containerTarget = null;
    this.currentTarget = null;
    this.fx.clear();
    this.damage.clear(fn => this.retire(fn)); // Iteration 14: the zombies' wound material clones are released after the warm-up too
    this.use = null;
    this.consumeReturn = null; // (consumable return: a new station / Retry starts with nothing pending)
    this.consumeView?.reset();
    this.flares.clear(); // Iteration 12 (LIGHT): burning / thrown flares, their lights, smoke, loops and light sources
    this.scents.clear(); // lane LURE: every lure scent ends with its station (travel / Retry / new game)
    this.grenades.clear(); // task studio-refinement-batch-20261113-035659-01: canisters, acid pools, lures
    this.flareHold.cancel(); // Iteration 15: a readied flare is dropped (nothing spent)
    this.throwItem = null;
    this.lmbLatch = false;
    this.laneOwnedLast = false;
    this.aiming = false;
  }

  /** Iteration 16: what the player changed in the live section -> its run memory (loose items with poses, holder lots, kills). */
  private saveSectionMemory(): void {
    const mem = this.run.memory(this.run.current);
    // (task train-loose-cargo: the items lying in the parked train are the TRAIN's — saved with it, never also as station loot)
    mem.pickups = capturePickups(this.pickups.list.filter(p => !this.trainCargo?.ownsPickup(p)), p => this.layoutPickup.get(p));
    if (this.containers) mem.holders = captureHolders(this.containers);
    const dead = this.zombies.filter(z => !z.brain.alive).map(z => this.enemyIndex.get(z)).filter((i): i is number => i !== undefined);
    mem.killed = mergeKilled(mem.killed, dead);
  }

  /**
   * Iteration 16: build `layout` as the live section `key` and put the player in it by `arrival`. `fresh` = NewGame
   * (Player.spawn: full health); otherwise Player.place keeps hp / stamina. The inventory, survival, battery and lane
   * state are NOT touched here (callers: newGame resets them before, retryLevel restores them before, travel keeps them).
   * The section's memory is applied: killed enemies stay dead, taken loot stays taken, dropped items come back once.
   */
  private buildSection(key: SectionKey, layout: StationLayout, arrival: Arrival, fresh: boolean): void { drainSync(this.buildSectionSteps(key, layout, arrival, fresh)); }
  /**
   * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): buildSection as steps (core/pacedBuild.ts) — the same lines in the
   * same order; each `yield` is a point where the journey's paced build (buildSectionPaced) lets the riding car's frame be drawn. Those
   * frames run only the transit gap (updateTransitGap; render() skips the level culler while transitGap) and draw the scene, where the
   * station's parts stand far outside the riding camera's view; every other route drains it at once (buildSection).
   */
  private *buildSectionSteps(key: SectionKey, layout: StationLayout, arrival: Arrival, fresh: boolean): BuildSteps<void> {
    this.lifecycleCounts.build++;
    const t0 = performance.now();
    this.layout = layout;
    this.currentSeed = layout.seed >>> 0;
    this.rand = mulberry32(layout.seed ^ 0x5bd1e995);
    // task train-all-cargo: the carried props exactly as the installed run has them (Retry / Load installed theirs after the prepare)
    for (const f of this.sectionLayoutHooks) { try { f(layout, key, this.run, 'build'); } catch (err) { console.warn('train-all-cargo: a layout hook failed', err); } }
    // Iteration 07 (Lane P2): the prepared layout (its lazy prop models loaded); placements whose model is missing are dropped.
    const p7Keys = p7ModelKeysFor(this.layout), keep = new Set(this.modelKeysFor(this.layout, key.level));
    dropUnloadedP7(this.layout, new Set(p7Keys.filter(k => this.propModels.has(k))));
    this.propModels.trim(keep, 16, foreignTo(key.level, this.propModels.catalogue)); // lane PACKAGE (track3): another level's own art never lingers as an extra
    this.levelResources.retainOnly(key.level, fn => this.retire(fn)); // lane PACKAGE (track3): the previous level's textures now, its owned GPU resources after the warm-up
    // Task track3-eaton-centre-20261031 (lane PERF): the mall's InstancedMeshes share one program per material (render/instancing.ts:
    // three gives every small InstancedMesh its own program; the atrium shows ~740 at once); Subway / Office build as before.
    setAttributeInstancing(!!this.layout.mall || !!this.layout.reactor); // task reactor-build-20261101 (lane ARCH): + the Reactor's open pit (every tier in view)
    // (lane PERF) in the mall the level's lazy models AND the boot models drop their decoded images once uploaded (GPU textures and
    // what is drawn unchanged; the colour samplers read exact thumbnails: assets/textureRelease.ts)
    if (this.layout.mall) {
      for (const k of keep) { const g = this.propModels.get(k); if (g) releaseModelTexturesAfterUpload(g); }
      for (const g of Object.values(this.assets.models)) releaseModelTexturesAfterUpload(g);
    }
    yield 'world';
    this.world = yield* buildWorldSteps(this.layout, this.mats, {...this.assets.models, ...this.propModels.record()} as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF>);
    requestArchitectureAnisotropy(this.world.group); // lane FIX (U08): every floor / wall / ceiling map asks for 16x before the first frame
    this.scene.add(this.world.group);
    this.steamVents = new SteamVents(this.fx, annexVents(this.layout), this.layout.seed >>> 0); // Track 2 (VIS)
    if (!this.containers) {
      this.containers = new ContainerManager(this.assets.models as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF>, this.mats, () => this.inv);
      this.containers.onEvent = e => this.onContainerEvent(e);
      this.scene.add(this.containers.group);
    }
    yield 'holders';
    // Searchable cabinets/crates; loot is rolled from the station seed + container index.
    // Task loot-tables-20261030 (lane LOOT): under the logical level's loot profile (items/lootTables.ts PROFILES; one per level).
    // (task studio-food-shelf-production-20261109-002816-01, lane ITEMS: + the food-variety realization of every holder's rolled lots, a
    // remembered holder exactly as its record names it — items/pantryVariety.ts)
    yield* this.containers.buildSteps(this.layout, this.propModels.record() as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF>, lootProfile(key.level),
      pantryHolderRealizer(key.level, this.run.peekMemory(key)?.holders ?? {}, lootProfile(key.level))); // iteration 08 (Lane I): openables split the lazy p7 models too
    dropUnrecordedSalvage(this.containers, this.run.peekMemory(key)?.holders ?? {}); // (task base-salvage: a remembered holder never gains the base salvage lot)
    for (const h of this.sectionHooks) h.holders?.(this.layout, key); // task fuel-feedback: fuel cans as loot lots (before the filler / memory); `key`: run.current is still the departure here
    yield 'navigation';
    applySkywaysStageSupport(this.layout); // (lane VENUE) after the world is drawn, before levels / prop index / paths / physics read the grid
    this.levels = levelsOf(this.layout);
    this.propIndex = new PropIndex(this.levels, this.layout.props);
    yield;
    this.pathfinder = yield* PathFinder.steps(this.levels); // Lane B: (level, cell) nodes; stairs join levels
    yield;
    this.vocalReach = new VocalReach(this.levels); // lane AUDIO: one bounded, time-sliced route field from the player (no search here)
    this.vocalReach.attachScheduler(this.frameBudget); // lane SCHED: its build slices run in spare frame time (this world's generation)
    // lane SCHED: the same search as below (brainWorld findPath); only far, not-in-sight chase re-plans are queued — and run
    // resumably on a fork of the finder (its own search buffers, allocated here on the loading screen; ~20 B per node)
    const farFinder = this.pathfinder.fork(), near = (x: number, z: number, y: number | undefined) => this.nearPlayer(x, z, y);
    // Task track3-eaton-centre-20261031 (lane HORDE, atrium AI): an OPEN-ATRIUM level (layout.mall) adds the per-frame chase search
    // cap / seen hand-over slack (ai/chaseShare.ts); every other level constructs the service exactly as before.
    const atrium = this.layout.mall || this.layout.reactor ? atriumPathOptions((x, z, y) => { const P = this.player; return Math.hypot(x - P.x, z - P.z, (y ?? P.y) - P.y) < PATH_DEFER.nearM; },
      (x, z, y) => { const P = this.player, fy = y ?? P.y, r = this.vocalReach; return atriumNearRule(Math.hypot(x - P.x, z - P.z, fy - P.y), fy - P.y, () => r?.ready ? r.pathTo(x, fy + 1.2, z) : null); }) : undefined;
    // (searchExpand: 26000 as always; a `local` request — only marked in an atrium level — gets ATRIUM_CHASE.localExpand)
    this.pathService = new PathService((ax, az, bx, bz, o) => this.pathfinder.find(ax, az, bx, bz, 0.34, searchExpand(o), o),
      (ax, az, bx, bz, o, chunk) => farFinder.search(ax, az, bx, bz, 0.34, searchExpand(o), o, chunk), this.frameBudget, near, atrium);
    this.chaseShare = this.layout.mall || this.layout.reactor ? new ChaseShare(this.levels) : null; // task reactor-build-20261101 (lane ARCH): + the Reactor's open pit (chase search cap / atrium path options above)
    this.sfx.setVocalReach(this.vocalReach);
    yield 'physics';
    this.physics.build(this.layout); // disposes the previous station's bodies and casings
    // Lane D: index the shared prop renderables for per-instance damage; breaks update holders + ragdoll statics.
    const cm = this.containers;
    // Iteration 07 (Lane K): items / chunks rest on real holder shelves; walkers shove loose light props.
    // Iteration 08 (Lane S): stocked shelving also collides by its real boards / backs (filler, items, chunks land on the right board).
    this.physics.holderBoxes = p => this.stock.physicsBoxes(p, cm.physicsBoxes(p));
    // Iteration 08 (Lane S): 3D filler stock dressed around the real loot lots (rest meshes + bodies on demand; no respawn per station).
    if (!this.stock.group.parent) { this.scene.add(this.stock.group); this.stock.filler.attach(this.physics); }
    yield 'stock';
    // (task studio-food-shelf-production-20261109-002816-01) + the shelf-junk atlas (lazy prop model; absent -> the same layout with the procedural fallbacks)
    yield* this.stock.buildSteps(this.layout, {models: {...this.assets.models, [SHELF_JUNK_KEY]: this.propModels.get(SHELF_JUNK_KEY)} as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF>,
      lotsOf: p => cm.holderFor(p)?.state.lots.map(l => placementBox(l.itemId, l)) ?? []});
    yield 'damage';
    // Iteration 16 (RUN): holders as the player left them (taken lots stay taken; the shelf filler keeps the gaps)
    const mem = this.run.memory(key);
    applyHolders(cm, mem.holders);
    // (task studio-food-drink-half-20261109-201124-01, user: "cut food / drink spawn in half") holders realized now for the first time keep
    // half their natural food / drink lots (a stable per-lot hash, no RNG stream; after the fuel lots and the filler); remembered ones stay exact
    dropNaturalFood(cm, mem.holders, this.layout.seed, mem.id, lootProfile(key.level));
    // Iteration 08 (Lane I): a shot trash can / wheelie bin still goes loose — its lid pops, its finite lots spill as pickups.
    this.physics.dynamicItems.holderLoose = p => { const carried = cm.goLoose(p); this.world.culler.release(carried); return carried; }; // Lane G: moving now
    // task office-interactions-layout-20261030 (lane PHYS): `wake` — in the office the player wakes light props by walking into them
    this.physics.dynamicItems.walkers = () => [{id: this.player, x: this.player.x, z: this.player.z, y: this.player.y, r: this.player.radius, wake: true},
      // (task studio-bb-production-20261112-234540-01: a BB on a wall / ceiling / in the air walks into nothing — its `y` is the floor below it)
      ...this.zombies.filter(z => z.brain.alive && !z.ragdolled && !(z.placesRoot && z.brain.climbing)).map(z => ({id: z, x: z.brain.x, z: z.brain.z, y: z.brain.y, r: z.brain.stats.radius}))];
    this.damage.build(this.layout, this.mats, [this.world.group, cm.group], {
      ownMeshes: p => cm.ownMeshes(p),
      onBreak: e => { const h = cm.holderFor(e.prop); if (h) cm.breakHolder(h, e.kind); this.physics.propsChanged(e.prop.x, e.prop.z); },
      pickups: () => this.pickups.list,
      // task reactor-expansion-20261101 (lane CONTROLS): bullet impacts on an arch-drawn finish (Reactor pit concrete / steel grating /
      // rusted plate, Office drywall / carpet …) take that finish's class and colour (world/finishAt.ts, damage/impactFinish.ts)
      finishAt: this.world.finishAt ?? null,
      finishMaterial: k => this.world.officeArch?.material(k) ?? this.world.mallArch?.material(k) ?? this.world.reactorArch?.material(k) ?? this.world.marketArch?.material(k), // (+ the market's: task studio-survivor-market-20261108-005807-01)
      // Iteration 07 (Lane K): shot items move — rigid items / chunks, loot lots lifted off holders (same item / count, never duplicated)
      physics: this.physics,
      lots: (o, d, maxT) => cm.shotLots(o, d, maxT).map(l => ({holder: l.holder, lotId: l.lotId, t: l.t})),
      lotsIn: box => cm.lotsInBox(box),
      detachLot: (h, lotId) => {
        const r = cm.detachLot(h as Parameters<typeof cm.detachLot>[0], lotId);
        if (!r) return null;
        const st = this.inv.makeStack(r.lot.itemId, r.lot.count);
        st.count = r.lot.count; // a lot may hold more than one stack (ammo): keep its finite count exactly
        return this.pickups.addAt(st, r.matrix, {holder: r.holder, lot: r.lot.id});
      },
    });
    // Audio: occlusion-lite (no line of sight -> muffled) + humming vending/stall emitters. Same Sfx/context.
    // (R4, round 2) + the service annexes' fans (audio/fanSound.ts; an empty list without annexes releases the previous world's fans)
    this.sfx.setWorld({occlusion: (x, z, y) => this.soundOccluded(x, z, y) ? 1 : 0, emitters: humEmitters(this.layout.props), fans: fanSources(this.layout)});
    yield 'lighting';
    // Iteration 05: every fixture baked into a persistent light field (camera-independent; no pooled lights).
    const max3D = maxTexture3DSize(this.renderer.backend as never); // Iteration 13 (CORE): WebGPU device limit / WebGL 2 MAX_3D_TEXTURE_SIZE
    // Iteration 13 (LIGHTING): `renderer` registers the TSL light-field node (world/lightFieldNode.ts) in its node library.
    this.lightPool = yield* StationLighting.steps(this.scene, this.layout, this.world.fixtures, this.world.tubes, {hemi: this.hemi, fogDensity: MOOD.fogDensity, far: this.camera.far, max3DTextureSize: max3D, renderer: this.renderer});
    // Iteration 06 (Lane F): haze density map + light-field rebind; station structure/containers cast the flashlight shadow.
    yield* this.atmosphere.setStationSteps(this.layout, this.lightPool.volume);
    this.atmosphere.markShadows(this.world.group, true);
    this.atmosphere.markShadows(this.containers.group, true);
    this.atmosphere.markShadows(this.stock.group, false); // Lane S: shelf stock casts the flashlight shadow too
    // Iteration 08 (Lane G): hide levels behind slabs (portal visibility) and chunks inside opaque fog.
    this.world.culler.register(this.containers.group);
    this.world.culler.register(this.stock.group);
    this.world.culler.maxDistance = fogCullDistance(MOOD.fogDensity);
    // Task mall-round2-20261031 (lane PERF): the mall's same-storey occlusion keeps whatever the flashlight sees too (its shadow pass
    // draws with the culler's layers); read only by that rule (world/levelCulling.ts OCCL_*), so Subway / Office are unaffected.
    this.world.culler.viewpoints = [this.flashlight];
    yield 'arrival';

    // Iteration 16 (RUN) / 17: the level's world is now the run's current one; the player starts at its start pose
    this.run.current = {...key};
    this.run.arrival = {...arrival};
    this.arrival = {...arrival};
    mem.visits++;
    // Task player-train-shell-20261101-202805 (lane PLACE): the parked player train of this level (pure, memoized per layout); a START
    // arrival (New game / Travel / Retry) spawns inside it at its interior floor (explicit y). Only the pose is set here: updates run
    // only in 'playing' (after this build and the warm-up), and lane TRAIN's sectionHooks.build below adds the car's floor volume and
    // colliders synchronously, so the player is never simulated before the train exists. The train identity follows the level.
    this.trainPlacement = playerTrainPlacement(this.layout);
    this.playerTrain.parkAt(key);
    const pose = arrivalPose(this.layout, arrival, this.trainPlacement);
    const lv = pose.level !== undefined && pose.level > 0 && pose.level < this.levels.count ? pose.level : 0;
    const y = pose.y ?? this.levels.grid(lv).floorAt(pose.x, pose.z); // Lane B: the arrival's own storey
    // (lane RIDE) a player riding the moving train keeps their car-local pose: the ride writes the world pose every frame (a NEW game
    // ends any ride first)
    if (fresh) this.trainRide?.reset();
    if (this.trainRide?.riding) { /* the car drives into this station; TrainRide.arrive() parks it at trainPlacement */ }
    else if (fresh) this.player.spawn(pose.x, pose.z, pose.yaw, y); else this.player.place(pose.x, pose.z, pose.yaw, y);
    this.ladderAim = null;
    this.recoilPitch = this.recoilYaw = this.bloom = this.shake = 0;
    this.lightSources.clear(); // Iteration 12: lights of the previous section (the flashlight / body glow re-register on the next update)
    // A fresh controller re-equips the held weapon (a reload in progress is cancelled: ammo is only taken when it completes)
    this.weapon = new WeaponController();
    this.syncHeld();

    // Iteration 05: each zombie wears a seeded body x outfit look (deterministic per station seed + spawn index; 'coated' = heavy coat outfit).
    // Falls back to the legacy single template (zombie-rigged.glb: Last-shift body + coat) when no registry body model is loaded.
    // Iteration 07 (Lane Q): each spawn's archetype comes from the layout (~5 % rat/dog, ai/creatureSpawn.ts).
    // Iteration 16 (RUN): enemies killed earlier in this run stay dead (not spawned again).
    this.enemyFallbacks = 0;
    yield 'enemies';
    for (const i of enemiesToSpawn(this.layout.zombies.length, mem)) {
      yield;
      if (this.sirens.skip(this.layout.zombies[i])) continue; // Task track1-siren-blightbelly-20261031 (lane SIREN): no Siren without her model (never a zombie stand-in)
      this.enemyIndex.set(this.spawnEnemy(this.layout.zombies[i], i), i);
    }
    this.wanderHomes = wanderHomesFor(this.layout, this.enemyIndex); // (lane SPAWNS: the lingerie store's variants / the damp Strainer keep their zone)
    // Task track3-eaton-centre-20261031 (lane HORDE): the roaming hordes walk the living members of their placed groups (killed
    // members stayed dead above; a group with none left stays dead). No spawning here: members are layout.zombies entries.
    if (this.layout.hordes?.length) {
      const byIndex = new Map<number, EnemyActor>();
      for (const [z, i] of this.enemyIndex) byIndex.set(i, z);
      // (task studio-skywalk-encounters-20261108-074144-01: Skyways version 5 hordes walk the Skyways patrol graph; the Mall's otherwise)
      this.hordes = new HordeDirector(this.layout, this.levels, i => byIndex.get(i)?.brain, spawnProfile(key.level).horde?.patrol, this.layout.skyways?.patrol);
    } else this.hordes = null;
    yield 'pickups';
    // Iteration 16 (RUN): first visit: the generated pickups; afterwards exactly the remembered loose items (dropped ones too)
    const plan = pickupPlan(this.layout.pickups.length, mem);
    // (task studio-weapon-variety-production-20261109-224355-01, lane LOOT-UI) a first spawn's weapon find identities, their loaded rounds and
    // the paired boxes' extra rounds (items/weaponVariety.ts: a stable hash of each find's origin, no RNG stream; remembered pickups never)
    // (task studio-turnstile-user-model-20261112-004550-01) from the pool this section's first spawn used (recorded in its memory, so a
    // Continue / Retry of a station whose loose items were never captured realizes the same finds; visits already counts this entry)
    const pool = sectionWeaponPool(mem.lanes, mem.visits - 1);
    const findPlan = plan.fromLayout.length ? weaponFindPlan(this.layout, key.level, mem.id, {pool}) : null;
    if (findPlan?.finds.length) mem.lanes[WEAPON_POOL_LANE] = pool;
    const weaponFinds = findPlan?.changes ?? null;
    for (const i of plan.fromLayout) {
      const p = this.layout.pickups[i];
      // Task mall-playtest-revision-20261031 (lane SHOPS, U11): a placement's own yaw (a gun lying along its gun-shop bench) wins; the
      // random yaw is still drawn so every other pickup keeps its stream. No pickup is ever filtered by the player's loadout here.
      const yaw = this.rand() * Math.PI * 2;
      // (task studio-food-drink-half-20261109-201124-01) half the natural food / drink floor finds stay (a stable hash of the layout index;
      // drawn after the yaw, so every other pickup keeps its stream); a skipped one is simply not there (the pickup memory records the rest)
      if (!keepLayoutPickup(this.layout.seed, mem.id, i, p)) continue;
      const wf = weaponFinds?.get(i); // (lane LOOT-UI: a diversified weapon find / its paired box — same count of finds, same rounds in total)
      const st = wf ? this.inv.makeStack(wf.itemId, wf.count, wf.mag) : this.inv.makeStack(pantryPickupItem(this.layout, i, key.level), p.count); // (lane ITEMS: a first spawn's food variety; same count)
      if (p.filter !== undefined) st.filter = p.filter; // mask lane: a found gas mask's seeded, partly used filter (gen/maskLoot.ts)
      this.layoutPickup.set(this.pickups.add(st, p.x, p.y, p.z, wf?.yaw ?? p.yaw ?? yaw), i); // (task studio-weapon-poses-slot-hierarchy-20261110-064835-01: a long find laid across its box's direction)
    }
    for (const rec of plan.restored) {
      const pk = restorePickup(this.pickups, this.inv, rec);
      if (rec.layoutIndex !== undefined) this.layoutPickup.set(pk, rec.layoutIndex);
    }
    this.wonAt = -1;
    this.wonShown = false;
    this.sectionCleared = mem.cleared;
    this.hud.reset();
    // Lane F: enemies block the flashlight beam — marked once per actor in spawnEnemy (iteration 07, Lane Q)
    this.genMs = performance.now() - t0;
    const codes = LEVEL_IDS.map(l => `${levelDisplayName(l, this.run.seeds[l])} ${seedToCode(this.run.seeds[l])}`).join(' · ');
    $('#seed-line').textContent = `${levelDisplayName(key.level, this.run.seeds[key.level])} · ${sectionLabel(key)}: ${this.layout.name}. Run codes: ${codes} (debug/share only; reloading the page always starts a new run).`;
    const obj = document.querySelector('#objective .obj-title');
    // Task studio-alpha-campaign-foundation-20261102-230708-01 (user: "No ordinary clear-all-zombies objective: default objective says
    // scavenge for resources and return to the train when done"): no kill goal anywhere; the Reactor keeps its real endgame chain.
    // (task studio-bunker-rework-20261109-205115-01: a long title — the Bunker's — on two balanced lines: ui/objectiveTitle.ts)
    if (obj) setObjectiveTitle(obj, key.level === 'reactor' ? 'Restart the reactor' : key.level === 'market' ? MARKET_OBJECTIVE : key.level === 'bunker' ? BUNKER_OBJECTIVE : SCAVENGE_OBJECTIVE); // (+ the market's: task studio-survivor-market-20261108-005807-01; + the bunker's: task studio-bunker-level-20261109-072224-01)
    yield 'hooks';
    for (const h of this.sectionHooks) h.build?.(this.layout); // Iteration 16: lane section content (before the warm-up runs)
    this.propModels.sealed = this.levelResources.sealed = true; // lane PACKAGE (track3): the level is built; a later fetch counts as `late`
    void this.preparePantry(null, this.run, true); // (lane ITEMS: carried pantry items restored after the prepare — a loaded save — get their models; usually a no-op)
    void this.prepareWeaponVariety(null, key, this.run, true); // (lane LOOT-UI: likewise carried / remembered new weapons; usually a no-op)
    this.updateCamera(0);
  }
  genMs = 0;

  /** Iteration 16: run-scoped lane systems that exist but registered no participant (INJURY / GEAR) — wired once, idempotent. */
  private wireRunLanes(): void {
    const self = this as unknown as {
      injuries?: {snapshot?(): unknown; restore?(d: unknown): void; reset?(): void};
      gear?: {reset?(): void; setStore?(s: unknown): void};
    };
    const inj = self.injuries;
    if (inj?.snapshot && inj.restore && inj.reset && !this.runParticipants.some(p => p.id === 'injuries')) {
      this.runParticipants.push({id: 'injuries', save: () => inj.snapshot!(), load: d => inj.restore!(d), reset: () => inj.reset!()});
    }
    const gear = self.gear;
    if (gear?.setStore && !this.bagStoreWired) { gear.setStore(runBagStore(() => this.run)); this.bagStoreWired = true; }
    // GEAR's own state (open bag view, readied bag) is closed by its section teardown; NewGame resets it. Its bags and worn
    // gear live in RUN memory / the Inventory, so a snapshot needs nothing from it.
    if (gear?.reset && !this.runParticipants.some(p => p.id === 'gear')) this.runParticipants.push({id: 'gear', save: () => null, load: () => {}, reset: () => gear.reset!()});
    // Task player-train-shell-20261101-202805 (lane PLACE): the run's one player train (NewGame: a fresh level-one train; Retry: as at entry)
    if (!this.runParticipants.some(p => p.id === PLAYER_TRAIN_PARTICIPANT)) this.runParticipants.push(this.playerTrain.participant());
  }
  private bagStoreWired = false;

  /** Iteration 16: install an inventory (in place when lane GEAR's loadJSON exists, keeping the object identity; else replace). */
  private installInventory(inv: Inventory): void {
    const live = this.inv as unknown as {loadJSON?(j: unknown): void};
    const next = inv as unknown as {toJSON?(): unknown};
    if (typeof live.loadJSON === 'function' && typeof next.toJSON === 'function') live.loadJSON(next.toJSON());
    else this.inv = inv;
  }

  /**
   * Iteration 16: NewGame state — fresh starter kit, survival 80/80, battery 80 % with the light OFF, lane state reset, run stats zeroed
   * (hp: Player.spawn). Only a FRESH game comes here (every newGame path: campaign New Game, the QA / dev level starts, the death
   * screen's New game); Retry / Load / Continue restore the saved light flags (restoreCarryFrom / installSave) and travel keeps the live one.
   */
  private resetCarry(): void {
    this.survival.reset(); // food/water 80/80
    // Iteration 12 (LIGHT): battery back to its 80 % start, no dip in progress. Task studio-beta-new-game-flashlight-off-20261105-022524-01
    // (user: "by default when starting a new game the light should not be on"): the light starts OFF (spot intensity 0 from this reset,
    // before the first frame; F switches it on; the warm-up lights the torch itself, so its passes / shadows are still prepared)
    this.torch.reset(undefined, {on: false});
    // Pistol lane: start with the pistol (15 + 45 x 9 mm) now that its art is ready; the rifle branch is the gate-off fallback.
    this.installInventory(starterInventory(this.startWeapon));
    this.stats = {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0};
    resetParticipants(this.runParticipants);
  }

  /** Iteration 16: Retry level — the carry state exactly as it was when the level was entered (no free heal or refill). */
  private restoreCarryFrom(snap: RunSnapshot): void {
    this.torch.reset(snap.battery.charge); // re-registers the light sources; the exact on / died flags follow
    this.survival.reset();
    const inv = restoreCarry(snap, {player: this.player, survival: this.survival, battery: this.torch.battery, stats: this.stats});
    this.torch.battery.update(0); // output from the restored flags
    this.installInventory(inv);
    this.player.alive = this.player.hp > 0;
    restoreParticipants(snap, this.runParticipants);
    this.inv.reserveUids(this.playerTrain.lockbox.maxUid()); // lane BOX: later stacks never reuse a Lockbox uid
    this.inv.reserveUids(this.playerTrain.equipment?.maxUid() ?? 0); // task train-crafting: nor a crafted chest's
  }

  /** Iteration 16: the Retry-level snapshot of the level just entered (carry state + that level's section memories). */
  private levelEntrySnapshot(): RunSnapshot {
    const k = this.run.current;
    return takeSnapshot({level: k.level, section: k.section, station: k.station, arrival: this.arrival},
      {inv: this.inv, player: this.player, survival: this.survival, battery: this.torch.battery, participants: this.runParticipants, stats: this.stats},
      this.run.scopeMemories(k)); // (campaign: this STATION's memories only)
  }

  // --- save / load (lane SAVE) ---------------------------------------------------------------------------------------------------
  // Task studio-alpha-campaign-foundation-20261102-230708-01 (lane SAVE): capture / apply of a CAMPAIGN run's save (save/*.ts). The
  // primary's travel orchestrator calls commitSave at the three autosave points — DEPARTURE (after the departing station's world was
  // torn down, campaign.transit set), ARRIVAL (the train stopped at the new station), NEW GAME (the start station) — and applySave
  // (after it tore the live world down with leaveSection(false)) before it builds / resumes the returned key. The menu lane reaches
  // the three slots through `saves` (list / read / delete / exportFile / importFile) and loads through applySave. Builds nothing.
  /** Lane NET's graph validator goes here once merged (`saveValidate.validateNetwork = validateNetwork`); read by saves + decodeSave. */
  readonly saveValidate: ValidateOptions = {validateNetwork: n => { const e = validateNetwork(n); return e.length ? {ok: false, errors: e} : null; }}; // (primary: lane NET's graph validator)
  /** The three localStorage save slots of this browser + origin (save/slots.ts). */
  readonly saves = new SaveSlots({validate: this.saveValidate});
  /** The slot this run saves into (null: not bound — a New Game / a load binds one). */
  currentSlot: number | null = null;
  /** The revision of currentSlot this run last wrote / loaded (an autosave never replaces another tab's newer revision). */
  saveRevision = 0;
  /** RunState.id bound to currentSlot (an autosave of any OTHER run is refused, so a new run never overwrites an old slot silently). */
  private saveRunId = -1;

  /** The player's pose in the parked player train's local frame (null: no train in this level). */
  trainLocalPose(): TrainLocalPose | null {
    const p = this.trainPlacement;
    if (!p) return null;
    const q = worldToTrain(p, this.player.x, this.player.y, this.player.z);
    const yaw = this.player.yaw - p.yaw;
    return {x: q.x, z: q.z, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), pitch: this.player.pitch, crouched: this.player.crouched};
  }

  /** A saved train-local pose in the parked train (kept inside the car) as a world pose on its interior floor; null without a train. */
  trainLocalToWorld(pose: TrainLocalPose): {x: number; y: number; z: number; yaw: number; pitch: number; crouched: boolean; level: number} | null {
    const p = this.trainPlacement;
    if (!p) return null;
    const c = clampTrainLocal(pose, PLAYER_TRAIN_SPEC.interior);
    const w = trainToWorld(p, c.x, PLAYER_TRAIN_SPEC.floorY, c.z);
    return {x: w.x, y: p.floorY, z: w.z, yaw: p.yaw + c.yaw, pitch: c.pitch, crouched: c.crouched, level: p.level};
  }

  /**
   * The current campaign run as a save envelope (SaveSlots.commit finalises meta.slot / revision / savedAt). `pose`: the player's
   * train-local pose (default: measured in the parked train, else the train's spawn point). Throws SaveError when the run cannot be
   * saved faithfully (no campaign; a run participant failed to save) — nothing is written then.
   */
  captureSave(reason: SavePoint, o: {slot?: number; pose?: TrainLocalPose} = {}): SaveFileV1Like {
    this.wireRunLanes();
    const pose = o.pose ?? this.trainLocalPose() ?? {...trainSpawnLocal(), yaw: 0, pitch: 0, crouched: false};
    const run = captureRun({run: this.run, inv: this.inv, player: this.player, survival: this.survival, battery: this.torch.battery,
      participants: this.runParticipants, stats: this.stats, clock: this.time, pose, point: reason});
    return makeSaveFile(run, deriveMeta(run, {slot: o.slot ?? this.currentSlot ?? 1, revision: this.saveRevision, savedAt: new Date().toISOString(), reason}));
  }

  /**
   * Capture + write. An AUTOSAVE (departure / arrival) goes into the slot bound to this run and refuses to replace another tab's
   * newer save; NEW GAME (or an explicit other `slot`) writes an empty slot, or a used one only with `overwrite` (the player
   * confirmed), and binds the run to it. Never throws: {ok: false, error} = nothing was saved (the previous save is intact).
   */
  commitSave(reason: SavePoint, o: {slot?: number; overwrite?: boolean; pose?: TrainLocalPose} = {}): CommitResult {
    const bind = reason === 'new-game' || (o.slot !== undefined && o.slot !== this.currentSlot);
    const slot = bind ? o.slot : this.currentSlot;
    if (slot === undefined || slot === null) return {ok: false, code: 'bad-slot', error: 'Not saved: choose a save slot for this run first.'};
    if (!bind && this.saveRunId !== this.run.id) return {ok: false, code: 'conflict', error: `Not saved: this run is not the one saved in slot ${slot}.`};
    let file: SaveFileV1Like;
    try { file = this.captureSave(reason, {slot, pose: o.pose}); } catch (err) { return {ok: false, code: 'invalid', error: `Not saved: ${String((err as Error)?.message ?? err)}`}; }
    const r = this.saves.commit(slot, file, o.overwrite ? {overwrite: true} : bind ? {} : {expectRevision: this.saveRevision});
    if (r.ok) { this.currentSlot = slot; this.saveRevision = r.meta.revision; this.saveRunId = this.run.id; }
    return r;
  }

  /**
   * Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CREDITS): THE ENDING SAVE — the Reactor credits' "Main
   * Menu" commits the run (reason 'ending') before it returns to the menu. The live station's deltas go into the run memory first by the
   * same NON-destructive captures a teardown makes (loose items / holders / kills, the grounded bags: the world stays live and a later
   * teardown captures again), so nothing carried is still lying in the saved station. A save's pose is train-local: Continue resumes at
   * the parked train's spawn point at this station. null = nothing to save (a run without a campaign: QA / legacy scratch runs).
   */
  commitEndingSave(): CommitResult | null {
    if (!this.run.campaign) return null;
    this.acidMelt?.clear(); // (refinement batch: a melt in progress completes first — spill, salvage, its record — never saved half done)
    if (this.world) { this.saveSectionMemory(); this.gear.flush(); this.fuelStations?.flush(); this.trainPropCargo?.flush(); this.corpses?.flush(); this.trainEquipment?.flush(); } // (task fuel-feedback: the station's fuel record with its memory; task train-all-cargo: its carried / lost props; lane CORPSE: the bodies lying in the station; task train-crafting: the crafted equipment left in it)
    return this.commitSave('ending', {pose: {...trainSpawnLocal(), yaw: 0, pitch: 0, crouched: false}});
  }

  /**
   * Task studio-refinement-batch-20261113-035659-01 (lane SAVE): why a MANUAL save (the train's Save terminal) cannot be made right now
   * (null: it can). Flags only — nothing is captured, read from storage or written. The slot checks are commitSave's own (same words).
   */
  saveBlock(): SaveRefusal | null {
    const no = (code: SaveRefusal['code'], error: string): SaveRefusal => ({ok: false, code, error});
    const c = this.run.campaign;
    if (!c) return no('no-campaign', 'Not saved: this run is not a campaign run, so it has no save.');
    if (this.state !== 'playing') return no('not-playing', 'Not saved: saving works only during play.');
    if (!this.player.alive) return no('dead', 'Not saved: you are dead.');
    if (this.trainRide?.riding || c.transit || this.transitGap) return no('moving', 'Not saved: the train is moving — save while it stands at a station.');
    if (this.lifecycle.busy) return no('busy', 'Not saved: busy — try again in a moment.');
    if (!this.world || !this.trainPlacement || !this.trainRuntime?.train) return no('no-train', 'Not saved: the train is not parked here.');
    if (!this.trainRuntime.playerInside()) return no('outside', 'Not saved: step inside the train to save.');
    // (the Bunker's cargo lift records its stop for a save; a car still travelling would carry things mid-shaft)
    if (this.tower?.office?.elevator?.logic.moving) return no('lift', 'Not saved: the lift is moving — save once it stops.');
    // (world/acidMelt.ts: a prop still dissolving holds its contents until it completes, and what stood on it is still falling: a save
    // now would catch it half done; it takes MELT.seconds)
    if (this.acidMelt?.busy) return no('acid', 'Not saved: acid is still eating through something — save in a moment.');
    if (this.currentSlot === null) return no('bad-slot', 'Not saved: choose a save slot for this run first.');
    if (this.saveRunId !== this.run.id) return no('conflict', `Not saved: this run is not the one saved in slot ${this.currentSlot}.`);
    return null;
  }

  /**
   * (lane SAVE) THE MANUAL SAVE — [E] at the train's Save terminal (world/trainSaveTerminal.ts). Refused (nothing captured or written)
   * whenever saveBlock says so. Otherwise the live station's deltas go into the run memory by the same NON-destructive captures the
   * ending save makes (loose items / holders / kills, the grounded bags, the fuel record, carried / lost props, the station's bodies and
   * crafted units) plus the other records a teardown writes (the office / Skyways panes, the Bunker lift's stop, the Skyways car, the
   * market's hostility, the Reactor credits) — the world stays live and its real teardown captures again — and the run is committed to
   * the ACTIVE slot (commitSave: this run's slot, expectRevision, validated, one write, read back) with the player's real train-local
   * pose, so Continue / Load last save resume right here. Never throws; a failed write leaves the slot's previous save as it was.
   * Autosaves, Continue and Retry are unchanged (run.entry, the level-entry snapshot, is saved exactly as it stands).
   */
  saveNow(): SaveNowResult {
    const no = this.saveBlock();
    if (no) return no;
    const pose = this.trainLocalPose();
    if (!pose) return {ok: false, code: 'no-train', error: 'Not saved: the train is not parked here.'};
    try {
      this.saveSectionMemory(); this.gear.flush(); this.fuelStations?.flush(); this.trainPropCargo?.flush(); this.corpses?.flush(); this.trainEquipment?.flush();
      this.gas?.flush?.(); // the office / Skyways window panes (otherwise written at teardown)
      const lift = this.tower?.office?.elevator?.logic;
      if (lift && !lift.moving && lift.stop !== null) this.tower.parkCar(); // a car level at a stop: only its record (nothing moves)
      this.skywaysCar?.store?.(); this.marketCombat?.persist?.(); reactorCreditsOf(this)?.store();
    } catch (err) { return {ok: false, code: 'invalid', error: `Not saved: ${String((err as Error)?.message ?? err)}`}; } // (as commitSave's capture: nothing written)
    return this.commitSave('manual', {pose});
  }

  /** The campaign's return to the main menu (main.ts pause / death "Main menu"; lane CREDITS' end card): the moving ride reset, the title. */
  returnToMenu(): void {
    this.trainRide.reset();
    this.setState('title');
  }

  /** Validate + decode a save WITHOUT touching the live game (its `run` can prepare the target section before the teardown). */
  decodeSave(file: unknown): {ok: true; restore: PreparedRestore & {slot: number; revision: number}} | {ok: false; error: string} {
    const v = validateSaveFile(file, this.saveValidate);
    if (!v.ok) return v;
    try {
      // (campaign-polish lane MAP) a save made before the Maintenance Route existed gets it here, once (minimal, deterministic; the next
      // autosave stores it): campaign/discovery.ts upgradeCampaign
      const p = prepareRestore(v.value.run, o => createRun({seeds: o.seeds, start: o.start, levels: LEVELS, rollGear: rollLevelGear, campaign: o.campaign}), (c, remembered) => {
        const u = upgradeCampaign(c, {remembered});
        if (u.status === 'added') console.info(`Terminal State: save compatibility — ${u.node} (${u.tier} station) became the Maintenance Route beside the Reactor (${u.info?.kind}, approach ${u.info?.approach}).`);
        else if (u.status === 'unchanged') console.warn(`Terminal State: save compatibility — no Maintenance Route could be added to this older save (${u.reason}); it loads unchanged.`);
        return u.state;
      });
      this.trainPropCargo?.notePrepared(p.run, p.data.participants as Record<string, unknown> | undefined); // (task train-all-cargo: their models are prepared too)
      this.corpses?.notePrepared(p.run, p.data.participants as Record<string, unknown> | undefined); // (lane CORPSE: the save's bodies' models too)
      return {ok: true, restore: {...p, slot: v.value.meta.slot, revision: v.value.meta.revision}};
    } catch (err) { return {ok: false, error: `This save cannot be loaded (${String((err as Error)?.message ?? err).slice(0, 160)}).`}; }
  }

  /**
   * Install a decoded save: the run (campaign, every station's memory, the Retry snapshot, playtime), the carried inventory / vitals /
   * survival / battery / stats, every run participant (train + Lockbox, injuries, gear, gas mask), the uid counters and the game
   * clock; binds the run to its slot. CALL ONLY AFTER the live world was torn down (leaveSection(false)): lane teardown hooks write
   * into the CURRENT run. Returns where to build (no transit: `key`, the player at `pose` in the parked train — trainLocalToWorld) or
   * the journey to resume once (`transit`: from the tunnel to transit.to).
   */
  installSave(p: PreparedRestore & {slot: number; revision: number}): RestoreHandoff {
    this.wireRunLanes();
    const {failed} = installRestore(p, {
      setRun: run => { this.run = run; },
      installInventory: inv => this.installInventory(inv),
      reserveUids: max => { this.inv.reserveUids(max); this.inv.reserveUids(this.playerTrain.lockbox.maxUid()); this.inv.reserveUids(this.playerTrain.equipment?.maxUid() ?? 0); },
      player: this.player, survival: this.survival, battery: this.torch.battery,
      resetBattery: charge => this.torch.reset(charge),
      participants: this.runParticipants, stats: this.stats,
      setClock: t => { this.time = t; },
    });
    this.torch.battery.update(0); // output from the restored flags
    this.arrival = {...p.run.arrival};
    this.currentSlot = p.slot;
    this.saveRevision = p.revision;
    this.saveRunId = p.run.id;
    this.saves.setLastSlot(p.slot);
    return {key: {...p.key}, pose: {...p.pose}, transit: p.transit ? {...p.transit} : null, point: p.point, failed};
  }

  /** decodeSave + installSave (invalid -> {ok: false, error} and NOTHING was applied). Same teardown rule as installSave. */
  applySave(file: unknown): ({ok: true} & RestoreHandoff) | {ok: false; error: string} {
    const d = this.decodeSave(file);
    if (!d.ok) return d;
    return {ok: true, ...this.installSave(d.restore)};
  }
  // --- end save / load (lane SAVE) -----------------------------------------------------------------------------------------------

  // --- campaign (primary, task studio-alpha-campaign-foundation-20261102-230708-01) -----------------------------------------------
  /** The paper subway map overlay (ui/paperMap.ts; lazily mounted). */
  private paperMapUi: PaperMap | null = null;
  private get paperMap(): PaperMap { return (this.paperMapUi ??= new PaperMap({})); }
  /** The state the travel map was opened from ('map' while open). */
  private mapBack: GameState | null = null;

  /**
   * NEW GAME (campaign): a fresh network (its own seed), the start station, the chosen slot (an occupied one only with `overwrite` =
   * the player confirmed). `dev`: a menu dev start — the run starts at the network's first node of that archetype (its own world)
   * instead of the start station. Resolves after the station is built and play entered (from a click); the new-game save is written
   * right away (a failure is reported, the run goes on unsaved).
   */
  async newCampaign(slot: number, o: {overwrite?: boolean; networkSeed?: number; dev?: {level?: LevelId}} = {}): Promise<{ok: true; saved: boolean; error?: string} | {ok: false; error: string}> {
    if (this.lifecycle.busy) return {ok: false, error: 'Busy — try again in a moment.'};
    const view = this.saves.list().find(v => v.slot === slot);
    if (!view) return {ok: false, error: `There is no save slot ${slot}.`};
    if (!view.empty && !o.overwrite) return {ok: false, error: `Slot ${slot} is in use — confirm overwriting it first.`};
    const net = generateNetwork(o.networkSeed ?? freshSeed());
    let state = newCampaign(net);
    const devNode = o.dev?.level ? net.nodes.find(n => n.archetype === o.dev!.level) : undefined;
    // task studio-survivor-market-20261108-005807-01 (lane LEVEL): a dev start of an archetype the network has no node of never starts
    // silently at another station (every network drawn with ORDINARY_WEIGHTS holds every archetype; this guards any other census)
    if (o.dev?.level && !devNode) return {ok: false, error: `This network has no ${archetypeLabel(o.dev.level)} station — try again for another network.`};
    if (devNode && devNode.id !== state.current) state = {...state, current: devNode.id, known: [devNode.id], visited: [devNode.id]};
    const w = await this.newGame(net.nodes.find(n => n.id === state.current)!.archetype, {campaign: state, enter: true});
    if (!w) return {ok: false, error: 'The new game could not start.'};
    const r = this.commitSave('new-game', {slot, overwrite: !view.empty});
    if (!r.ok) { this.hud.toast(r.error, true); return {ok: true, saved: false, error: r.error}; }
    this.saves.setLastSlot(slot);
    return {ok: true, saved: true};
  }

  /**
   * CONTINUE / LOAD: the slot's run (default: the last-used valid slot). Validated + decoded first (nothing live is touched by a bad
   * save), the target station prepared, then the old world torn down, the run installed and the station built with the player at
   * the saved train-local pose in the parked train; a save taken at a DEPARTURE resumes that journey once (from the tunnel).
   */
  async continueCampaign(slot?: number): Promise<{ok: true} | {ok: false; error: string}> {
    if (this.lifecycle.busy) return {ok: false, error: 'Busy — try again in a moment.'};
    const n = slot ?? this.saves.continueSlot();
    if (n === null || n === undefined) return {ok: false, error: 'There is no save to continue.'};
    const raw = this.saves.read(n);
    if (!raw.ok) return {ok: false, error: raw.error};
    const d = this.decodeSave(raw.file);
    if (!d.ok) return d;
    const lock = this.beginGesture();
    const back = this.state;
    const flight = this.lifecycle.run(async (): Promise<{ok: true} | {ok: false; error: string}> => {
      const run = d.restore.run, c = run.campaign!;
      const resuming = !!c.transit;
      const node = run.node(resuming ? c.transit!.to : c.current)!;
      const key: SectionKey = {level: node.archetype, section: 'main', station: node.id};
      const ui = this.showLoading(node.name, `Preparing ${node.name}…`); // (lane MENU, campaign polish item 9: the location name only)
      await nextPaint();
      let layout: StationLayout;
      try { layout = await this.prepareSection(key, run, this.progressTo(ui, 'Loading station props')); } catch (err) { this.lifecycleFailed(err, back, ui); return {ok: false, error: 'The station could not be prepared.'}; }
      await this.warmRun;
      this.leaveSection(false); // the old run's world goes (its lanes write into the OLD run); then the save's run is installed
      const h = this.installSave(d.restore);
      if (h.transit) {
        // the journey resumes once: the run arrives at the destination (the departure station was already left and saved)
        this.run.campaign = {...arriveCampaign(this.run.campaign!, h.transit.to), transit: null};
      }
      this.buildSection(key, layout, {kind: 'start'}, false);
      const wp = this.trainLocalToWorld(h.pose);
      if (wp) { this.player.place(wp.x, wp.z, wp.yaw, wp.y); this.player.pitch = wp.pitch; }
      if (h.transit) this.run.entry = this.levelEntrySnapshot();
      this.updateStationIntro();
      const w = await this.prepareGraphics(ui);
      if (w.status === 'cancelled') return {ok: false, error: 'The graphics device was lost.'};
      this.readyLine(ui, w);
      if (h.transit) { const r = this.commitSave('arrival'); if (!r.ok) this.hud.toast(r.error, true); }
      if (h.failed.length) this.hud.toast(`Some saved parts could not be restored: ${h.failed.join(', ')}`, true);
      void lock.then(() => this.enterPlay());
      return {ok: true};
    });
    return (await flight) ?? {ok: false, error: 'Busy — try again in a moment.'};
  }

  /**
   * Task studio-beta-campaign-polish-20261103-063841-01 (lane MENU, DEATH): what the death screen's "Load last save" would restore —
   * the ACTIVE slot (the one this run is bound to) and its latest valid PERSISTED save, or why there is none (not a campaign run, no
   * slot bound, storage unavailable, the slot empty / unreadable). Read-only: nothing is written or erased.
   */
  lastSaveStatus(): LastSaveStatus {
    if (!this.run.campaign) return {ok: false, reason: 'no-campaign', message: 'This run is not saved.'};
    const slot = this.currentSlot;
    if (slot === null) return {ok: false, reason: 'no-slot', message: 'This run has no save to load.'};
    let v: ReturnType<SaveSlots['list']>[number] | undefined;
    try { v = this.saves.list().find(x => x.slot === slot); } catch { v = undefined; }
    if (!v || (v.empty && v.error)) return {ok: false, reason: 'unavailable', message: 'Saves are unavailable in this browser.'};
    if (v.empty) return {ok: false, reason: 'empty', message: `Save slot ${slot} is empty.`};
    if (!v.valid || !v.meta) return {ok: false, reason: 'invalid', message: `The save in slot ${slot} cannot be loaded${v.error ? ` (${v.error.slice(0, 120)})` : ''}.`};
    return {ok: true, slot, meta: v.meta};
  }

  /**
   * (lane MENU, DEATH) "Load last save": the active slot's latest valid persisted save through the SAME path as the main menu's
   * Continue (continueCampaign: read + validate + decode before anything live is touched; the save's station is prepared, then the
   * dead world is torn down and the run installed). Never saves the dead state, never erases or invalidates the slot, never starts a
   * New Game; other slots are untouched. No valid save -> {ok: false} with the honest reason and nothing changes.
   */
  async loadLastSave(): Promise<{ok: true} | {ok: false; error: string}> {
    const st = this.lastSaveStatus();
    if (!st.ok) return {ok: false, error: st.message};
    return this.continueCampaign(st.slot);
  }

  /**
   * The train console: the paper map in TRAVEL mode (the current station + every one-hop neighbour revealed and remembered; task
   * train-crafting: every station within TWO stops while a route radar is plugged into the train — world/trainEquipment.ts routeRadius).
   */
  openTravelMap(mode: 'travel' | 'view' = 'travel'): boolean {
    const run = this.run;
    if (!run.campaign || this.mapBack) return false;
    if (mode === 'travel') run.campaign = revealAround(run.campaign, run.campaign.current, this.trainEquipment?.routeRadius() ?? 1);
    // (task studio-alpha-survival-controls-20261107-060450-01) E / Tab close the map too: the ones physically down now (the console's E)
    // close it only after a release; the key that closes it is kept from the game until released (no interact / inventory / depart)
    const heldKeys = ['KeyE', 'Tab'].filter(c => this.input.down(c));
    this.mapBack = this.state;
    this.setState('map');
    this.paperMap.open({
      state: run.campaign, mode, heldKeys,
      onConfirm: to => { this.closeTravelMap(); void this.travelToStation(to); },
      onClose: key => { if (key) this.input.suppressUntilRelease(key); this.closeTravelMap(); },
      onCheat: () => (run.campaign = enableCheat(run.campaign!)),
      fuel: this.mapFuel(), // task train-fuel-system: station fuel bars, the trip's cost and the train's reserves
    });
    return true;
  }

  /** Task train-fuel-system: the map's fuel figures (fuel/fuel.ts units: quarter tanks). */
  mapFuel(): MapFuel {
    return {
      node: id => this.fuelStations.nodeFuel(id),
      aboard: () => reservesOf(this.playerTrain.fuel.tank, this.fuelCartsLike()?.aboard() ?? [], this.playerTrain.lockbox.slots),
      cost: hops => routeCost(hops, !!this.run.campaign?.cheat),
    };
  }

  private closeTravelMap(): void {
    if (!this.mapBack) return;
    const back = this.mapBack;
    this.mapBack = null;
    if (this.paperMap.isOpen) this.paperMap.close();
    if (back === 'playing' || back === 'map') void this.enterPlay();
    else this.setState(back);
  }

  private campaignTickT = 0;
  /**
   * (campaign) ~1 Hz: the Reactor's persisted ending phase (reactor.state.ending, the surface-ending contract) — the player reaching the
   * surface WINS the run once (no modal; the ending's own message is never replayed).
   */
  private campaignTick(dt: number): void {
    const c = this.run.campaign;
    if (!c || c.won || this.run.current.level !== 'reactor' || (this.campaignTickT -= dt) > 0) return;
    this.campaignTickT = 1;
    const st = this.run.laneStore<{ending?: {surfaced?: boolean}}>('reactor.state');
    if (st?.ending?.surfaced === true) this.onCampaignWin('surface');
  }

  /** True while no station world exists during a journey (the old one torn down, the next not built yet). */
  private transitGap = false;

  /** The transit gap's update: look, the riding car + the player in it, the camera. Nothing touches a station world. */
  private updateTransitGap(dt: number): void {
    const inp = this.input, p = this.player;
    applyMouseLook(p, inp.dx, inp.dy, this.settings); // task mouse-axis-invert: the one look step (sensitivity, X / Y inverts, pitch clamp)
    if (inp.hit('KeyF')) this.toggleFlashlight(); // task campaign-polish (lane TRAIN, item 15): the dark transit — the flashlight stays usable
    if (this.trainRide.riding) this.trainRide.stepPlayer(dt, inp, {aiming: false, speedMult: 1, canSprint: false});
    this.updateCamera(dt);
    this.trainRide.tiltCamera(this.camera);
  }

  /**
   * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD; user: less stutter): the journey's build of the next station,
   * PACED — buildSectionSteps drained in slices of a few ms between the riding car's frames (core/pacedBuild.ts) instead of seconds of
   * frozen frames. The ONLY paced caller is travelToStation, inside the transit gap (Game.update runs only updateTransitGap; render() leaves
   * the level culler alone); the identical steps as buildSection. A teardown meanwhile (stationGen moved: the journey's single flight never
   * lets one start) abandons it (PacedBuildCancelled). `genMs` = its main-thread work, not the ride's wall time.
   */
  private async buildSectionPaced(key: SectionKey, layout: StationLayout, arrival: Arrival, fresh: boolean): Promise<void> {
    const gen = this.stationGen, stats = (this.journeyBuild = newPacedStats());
    await runPaced(this.buildSectionSteps(key, layout, arrival, fresh), {...this.buildPacing, stats, alive: () => gen === this.stationGen});
    this.genMs = stats.workMs;
  }
  /** Lane BUILD: the paced build's options (core/pacedBuild.ts PACED_BUILD defaults; tests / QA may override). */
  buildPacing: PacedBuildOptions = {};
  private journeyBuild: PacedBuildStats | null = null;
  /** Lane BUILD: the last journey build's slices / steps / main-thread ms (QA). */
  get journeyBuildStats(): PacedBuildStats | null { return this.journeyBuild; }

  /**
   * THE JOURNEY (campaign): the occupied train leaves the current station for `to` (adjacent, or any node with the 1337 cheat, or —
   * campaign-polish lane MAP, widened by task gameplay-feedback lane TRAVEL — any KNOWN station over the cheapest route of known track:
   * campaign/discovery.ts travelPlan; fuelCheck charges the complete route, hops x one tank, or refuses with the numbers). A multi-hop trip
   * is ONE continuous journey: one departure, one transit (the ride gets the route), only the destination prepared / built / arrived
   * at — the stations passed are never loaded, looted, revealed or healed at; one departure autosave (the transit carries its route),
   * one arrival autosave.
   * 1. depart (refused unless the player is inside; doors close; the car pulls into the tunnel and loops in the transit);
   * 2. the old world is torn down (every delta flushed into the run) and the DEPARTURE autosave commits the pending journey;
   * 3. the next station is prepared and built while the car runs through the dark tunnel (its pipelines compiled in the background);
   * 4. the car arrives and stops at the platform; the run arrives (visited) and the ARRIVAL autosave commits.
   * A destination that cannot be prepared (twice) sends the train back to the station it left; nothing is lost.
   */
  async travelToStation(to: string): Promise<{ok: true} | {ok: false; error: string}> {
    const run = this.run, c0 = run.campaign;
    if (!c0) return {ok: false, error: 'No campaign run.'};
    if (this.lifecycle.busy || this.trainRide.riding) return {ok: false, error: 'The train is busy.'};
    const plan = travelPlan(c0, to);
    if (!plan) return {ok: false, error: 'That station cannot be reached from here.'};
    const target = run.node(to)!;
    // Task train-fuel-system: the route's fuel (hops x one tank; the map cheat waives it), checked BEFORE anything moves: a cart in a
    // doorway refuses, short reserves stall the engine audibly (nothing changes); otherwise the carts aboard become cargo and, once the
    // car is in the tunnel, the exact draw is made and recorded with the journey (charged once; refunded only if it fails back).
    const fuel = this.fuelCheck(plan.hops);
    if (!fuel.ok) return {ok: false, error: fuel.error};
    // reserved NOW (before the doors close): nothing drawn here can be taken out of the chest / a cart while the car leaves
    const debit = fuel.debit;
    this.playerTrain.fuel.tank = applyDebit(debit, this.playerTrain.fuel.tank, fuel.carts, this.playerTrain.lockbox.slots);
    this.fuelCartsLike()?.captureCargo();
    // (lane BUILD) the destination's layout now, at the confirmation: the generator cannot be sliced, the moving ride must not freeze
    this.pregenerateSection({level: target.archetype, section: 'main', station: target.id}, run);
    // the ride's route (lane TRAIN: world/trainRide.ts depart(journey?: RideJourney); bounded extra transit time per extra hop)
    const d = await this.trainRide.depart({route: plan.route});
    if (d.status !== 'in-tunnel') { this.pregenerated = null; this.fuelCartsLike()?.releaseCargo(); this.refundFuel(debit, fuel.carts); this.hud.toast(d.message, true); return {ok: false, error: d.message}; }
    if (fuel.cost) this.hud.toast(`${plan.hops > 1 ? `${plan.hops} stops` : 'One stop'}: ${tanksText(fuel.cost)} of fuel burnt`);
    const flight = this.lifecycle.run(async (): Promise<{ok: true} | {ok: false; error: string}> => {
      const from = run.campaign!.current;
      const ride = this.trainRide.state();
      const pose: TrainLocalPose = {x: ride.local.x, z: ride.local.z, yaw: ride.local.yaw, pitch: this.player.pitch, crouched: this.player.crouched};
      await this.warmRun;
      this.transitGap = true;
      // the departing station's every delta goes into its memory (one world per station). Its geometry goes now; its queued program /
      // pipeline releases (Iteration 14) wait until the next station has rendered at the platform: Subway -> Subway shares those
      // programs, and releasing them first recompiles them all on arrival (on a software rasterizer that memory is never returned)
      this.leaveSection(true);
      run.campaign = {...run.campaign!, transit: {...transitOf(run.campaign!, plan), fuel: {cost: fuel.cost, debit}}};
      const s1 = this.commitSave('departure', {pose});
      if (!s1.ok && this.currentSlot !== null) this.hud.toast(s1.error, true);
      for (const l of this.campaignListeners) l('transit');
      let dest = target, layout: StationLayout | null = null, key: SectionKey = {level: dest.archetype, section: 'main', station: dest.id};
      for (const attempt of [0, 1, 2]) {
        if (attempt === 2) {
          dest = run.node(from)!; key = {level: dest.archetype, section: 'main', station: dest.id}; this.hud.toast(`${target.name} cannot be reached — the train returns to ${dest.name}.`, true);
          this.refundFuel(debit, fuel.carts); // (task train-fuel-system) the journey never left: exactly what it drew comes back
        }
        try { layout = await this.prepareSection(key, run); break; } catch (err) { console.warn('campaign: preparing', key, 'failed', err); this.trainRide.transitFailed(String((err as Error)?.message ?? err)); }
      }
      if (!layout) { this.transitGap = false; this.lifecycleFailed(new Error('no station could be prepared'), 'playing', this.titleWarmupUi()); return {ok: false, error: 'No station could be prepared.'}; }
      await this.warmRun;
      // (lane BUILD) paced: the riding car keeps being drawn while the station is built; the riding car is adopted at the new placement (lane RIDE)
      try { await this.buildSectionPaced(key, layout, {kind: 'start'}, false); } catch (err) { if (!(err instanceof PacedBuildCancelled)) throw err; this.transitGap = false; return {ok: false, error: 'The journey was interrupted.'}; }
      this.transitGap = false;
      await this.backgroundCompile();
      const a = await this.trainRide.arrive();
      if (a.status !== 'stopped') console.warn('campaign: arrival', a);
      await nextPaint();
      this.flushRetired(); // the previous station's queued releases (its programs are re-used by now)
      run.campaign = {...arriveCampaign(run.campaign!, dest.id), transit: null};
      run.entry = this.levelEntrySnapshot();
      this.updateStationIntro();
      const s2 = this.commitSave('arrival');
      if (!s2.ok && this.currentSlot !== null) this.hud.toast(s2.error, true);
      this.hud.toast(`${dest.name} — ${archetypeLabel(dest.archetype)}`);
      for (const l of this.campaignListeners) l('arrived');
      return {ok: true};
    });
    return (await flight) ?? {ok: false, error: 'Busy — try again in a moment.'};
  }

  /** Task train-fuel-system: the world's fuel carts (world/fuelCarts.ts), if installed. */
  private fuelCartsLike(): FuelCartsLike | null {
    const c = (this as unknown as {fuelCarts?: Partial<FuelCartsLike>}).fuelCarts;
    return c && typeof c.aboard === 'function' && typeof c.departBlock === 'function' && typeof c.captureCargo === 'function' && typeof c.releaseCargo === 'function' ? c as FuelCartsLike : null;
  }

  /**
   * Task train-fuel-system: can the train make a `hops`-edge trip now? Draws nothing. Refusals give their feedback here: a cart in a
   * doorway (short toast), or short reserves (the engine cranks and stalls + a toast with the numbers). The map 1337 cheat waives the cost.
   */
  fuelCheck(hops: number): {ok: true; cost: number; debit: FuelDebit; carts: CartFuel[]} | {ok: false; error: string} {
    const cheat = !!this.run.campaign?.cheat, cost = routeCost(hops, cheat);
    const carts = this.fuelCartsLike();
    // (task train-all-cargo: nor a prop in a doorway; task cargo-overflow: nor more aboard than can travel — props, then loose items / bags)
    const block = carts?.departBlock() ?? this.trainPropCargo?.departBlock() ?? this.trainCargo?.departBlock?.() ?? this.corpses?.departBlock() ?? this.trainEquipment?.departBlock() ?? null; // (lane CORPSE: + a body in a doorway / too many aboard; task train-crafting: + a crafted unit in a doorway / too many aboard)
    if (block) { this.hud.toast(block, true); this.sfx?.denied(); return {ok: false, error: block}; }
    const aboard = carts?.aboard() ?? [], tf = this.playerTrain.fuel, chest = this.playerTrain.lockbox.slots;
    const debit = planDebit(cost, tf.tank, aboard, chest);
    if (!debit) {
      const r = reservesOf(tf.tank, aboard, chest);
      const msg = `Not enough fuel — ${hops > 1 ? `${hops} stops need` : 'this stop needs'} ${tanksText(cost)}, the train has ${tanksText(r.total)}. Find fuel cans (a can is ¼ tank) or a fuel cart.`;
      (this.sfx as {engineStall?(): void} | undefined)?.engineStall?.();
      this.hud.toast(msg, true);
      return {ok: false, error: msg};
    }
    return {ok: true, cost, debit, carts: aboard};
  }

  /** Task train-fuel-system: a journey that failed back to its start gets exactly its fuel back (tank, carts, chest stacks by uid). */
  private refundFuel(debit: FuelDebit, carts: CartFuel[]): void {
    const box = this.playerTrain.lockbox;
    this.playerTrain.fuel.tank = refundDebit(debit, this.playerTrain.fuel.tank, carts, box.slots, (count, uid) => {
      const st = this.inv.makeStack(FUEL.canItem, count);
      st.count = count;
      st.uid = uid; // the same item back (its uid was never reused: Lockbox uids stay reserved)
      return st;
    });
  }

  /**
   * The next station's pipelines compiled WITHOUT hiding the canvas or holding frames (the player is riding through the tunnel).
   * Task studio-performance-recorder-20261103 (lane RENDER-CPU; user: "the lag is also bad in reactor … the new loading transitions in
   * the train … might be skipping the warmup / compile step"): this journey route is the one that never runs the loading-screen
   * warm-up, and its former compile could not prepare the station — it compiled `world.group` alone at the top level into the CANVAS
   * context (no render target set), while the station draws into the atmosphere's scene pass one call level deeper
   * (render/renderContextDepth.ts): a different render context, so every node build and render object was made again on arrival;
   * culled meshes (off the camera layers), the holders / loot display / shelf stock / enemies / pickups (outside world.group) and the
   * hidden-until-used holder contents were never projected at all. Now the warm-up's own planner picks the station's representatives
   * (pools included; 'full': every other renderable too, for its own render objects), nearest the arrival first, and
   * render/journeyCompile.ts prepares them for the WHOLE ride (and after it, until done), time-sliced through the frame-budget
   * scheduler: the scene pass's node builds / render objects into its real render context and, side by side ('full', flashlight casting), the
   * shadow-map variants by off-screen draws nested at the real frame's depth. The arrival still waits at most 8 s for the scene-pass
   * phase; nothing holds a frame or hides the canvas. 'view' (software rasterizer): the representatives within 24 m only.
   */
  private async backgroundCompile(): Promise<void> {
    if (!this.world || !this.renderer.initialized || this.gpu?.deviceLost) return;
    const mode = warmupMode(location.search, this.softwareGl?.software === true);
    if (mode === 'off') return;
    this.journeyCompile?.cancel();
    this.refreshRuntimeVariants(mode); // task runtime-variant-warmup-20261105: the destination's play-only variants join the paced job
    const t0 = performance.now();
    const near = this.trainPlacement ? new THREE.Vector3(this.trainPlacement.x, this.trainPlacement.floorY, this.trainPlacement.z) : this.camera.getWorldPosition(new THREE.Vector3());
    try {
      const target = this.atmosphereBypass ? null : this.atmosphere.warmTarget(this.scene, this.camera);
      const depth = this.sceneDepth(false); // (measured by this session's loading-screen warm-up: the atmosphere pipeline persists)
      const plan = planWarmup(this.scene, {mode, cameraMask: this.camera.layers.mask, pools: this.warmRegistry.poolRoots(), near: mode === 'view' ? {center: near, radius: 24} : undefined});
      const sphere = new THREE.Sphere(), box = new THREE.Box3();
      const dist = (o: THREE.Object3D) => { box.setFromObject(o); if (box.isEmpty()) return Infinity; box.getBoundingSphere(sphere); return Math.max(0, sphere.center.distanceTo(near) - sphere.radius); };
      const byNear = <T extends {object: THREE.Object3D}>(l: readonly T[]) => l.map(i => ({i, d: dist(i.object)})).sort((a, b) => a.d - b.d).map(x => x.i);
      const items = [...byNear(plan.items), ...(mode === 'full' ? byNear(plan.others) : [])];
      // task mall-horde-performance-20261105 (the user's GAME71 Mall trace): the prepared play-only variants (the runtime-variant pool,
      // the loot highlight copies: userData.runtimeVariant) sit at the world origin, so "nearest the arrival first" put their shadow
      // variants LAST — after arrival, where busy frames leave no spare time and the job advanced only by its overdue rule, one forced
      // step every 2 s building one of them (all 16 in-play builds of that capture, 5-22 ms each). Their shadow variants go first
      // (prepared during the ride); the scene lane keeps its order (its representatives already include them, before 'others').
      const casters = mode === 'full' && this.flashlight.castShadow ? runtimeVariantsFirst(byNear([...plan.items, ...plan.others].filter(i => i.caster))) : [];
      const receiver = plan.items.find(i => i.object.receiveShadow && !i.flips.length) ?? null;
      // (task journey-compile-pacing-20261104: paced to real frames — frameNo = the scheduler's frame callbacks begun)
      const job = (this.journeyCompile = new JourneyCompile({renderer: this.renderer as unknown as JourneyCompileOptions['renderer'], scheduler: this.frameBudget,
        scene: this.scene, camera: this.camera, target, depth, items, casters, receiver, frameNo: () => this.frameBudget.frame}).start());
      // the arrival waits for the scene-pass phase at most 8 s, as before; the job keeps going in spare frame time after that
      await Promise.race([job.sceneDone, new Promise(r => setTimeout(r, 8000))]);
      const st = job.stats;
      console.info(`Terminal State: next station prepared during the ride (${mode}) — scene ${st.sceneDone}/${st.sceneItems}, shadows ${st.shadowDone}/${st.casters} at arrival after ${((performance.now() - t0) / 1000).toFixed(1)} s (continuing in spare frame time)`);
      void job.done.then(() => console.info(`Terminal State: journey compile ${job.stats.phase} — scene ${job.stats.sceneDone}/${job.stats.sceneItems}, shadows ${job.stats.shadowDone}/${job.stats.casters}, ${job.stats.steps} steps (max ${job.stats.stepMaxMs.toFixed(1)} ms), ${((performance.now() - t0) / 1000).toFixed(1)} s`));
    } catch (err) { console.warn('campaign: background compile failed', err); }
  }

  /** Lane RENDER-CPU: the journey's background preparation of the next station (render/journeyCompile.ts; QA / tests). */
  get journeyCompileStats(): JourneyCompile['stats'] | null {
    return this.journeyCompile?.stats ?? null;
  }
  // --- end campaign (primary) ----------------------------------------------------------------------------------------------------

  /** Iteration 16: from a click — audio resumes and pointer lock is requested inside the gesture (the rebuild can outlast it). */
  private beginGesture(): Promise<boolean> {
    this.sfx.init();
    return this.input.lock();
  }

  /** The loading screen as a warm-up UI: its map, its (visually hidden) progress line and the QA start button. */
  private titleWarmupUi(): WarmupUi {
    return {meter: this.loadMeter ?? null, label: $('#load .label'), button: $('#btn-start') as HTMLButtonElement};
  }

  /**
   * Iteration 16: the title panel as the loading screen (menu travel, new game, retry, Continue). Lane MENU (campaign polish item 9):
   * `place` = the destination's location name; `label` = the progress line (kept for the hooks, visually hidden). The map starts
   * over with every load.
   */
  private showLoading(place: string, label: string): WarmupUi {
    this.lifecycleCounts.loading++;
    const ui = this.titleWarmupUi();
    $('#station-intro').textContent = place;
    ui.meter?.reset();
    ui.label.textContent = label;
    if (ui.button) ui.button.disabled = true;
    $('#title').dataset.mode = 'loading';
    if (this.state !== 'loading') this.setState('loading');
    return ui;
  }

  /** Iteration 16: lazy-model progress on a warm-up UI. */
  private progressTo(ui: WarmupUi, what: string): (f: number, file: string) => void {
    return (f, file) => { ui.meter?.stage('props', f); ui.label.textContent = `${what} · ${file} · ${Math.round(f * 100)}%`; };
  }

  /** Iteration 16: the warm-up is done — the loading screen's ready line (and the start button). */
  private readyLine(ui: WarmupUi, w: WarmupResult): void {
    const note = warmupNote(w);
    ui.label.textContent = `Ready · ${this.layout.areas.length} spaces generated${note ? ` · ${note}` : ''}`;
    ui.meter?.complete();
    if (ui.button) ui.button.disabled = false;
  }

  /**
   * Iteration 16 (RUN): NEW GAME — a fresh run starting at `level`'s entry section: the iteration-15 starter kit, full
   * health, survival 80/80, battery 80 %, no injuries / gear, new level seeds (unless given) with a new gear roll, no
   * section memories. `enter` (a click): pointer lock is requested inside the gesture and play starts after the
   * warm-up; otherwise the caller shows the title (boot, the title's level choice). Single flight with travel / retry:
   * resolves null if another lifecycle operation is running.
   */
  newGame(level: LevelId, o: {seeds?: Partial<Record<LevelId, number>>; enter?: boolean; campaign?: CampaignState} = {}): Promise<WarmupResult | null> {
    if (this.lifecycle.busy) return Promise.resolve(null);
    const lock = o.enter ? this.beginGesture() : null;
    const back = this.state;
    const flight = this.lifecycle.run(async () => {
      this.wireRunLanes();
      // (campaign) a network run starts at the campaign's current station (its archetype builds it, its node seed seeds it)
      const startNode = o.campaign?.network.nodes.find(n => n.id === o.campaign!.current);
      if (startNode) level = startNode.archetype;
      const def = LEVELS[level];
      const seeds: Record<LevelId, number> = {subway: o.seeds?.subway ?? freshSeed(), office: o.seeds?.office ?? freshSeed(), mall: o.seeds?.mall ?? freshSeed(), market: o.seeds?.market ?? freshSeed(), bunker: o.seeds?.bunker ?? freshSeed(), skyways: o.seeds?.skyways ?? freshSeed(), reactor: o.seeds?.reactor ?? freshSeed()}; // (+ mall: lane GEN; + reactor: task reactor-build-20261101)
      const key: SectionKey = startNode ? {level, section: def.entry, station: startNode.id} : {level, section: def.entry};
      const run = createRun({seeds, start: key, levels: LEVELS, rollGear: rollLevelGear, campaign: o.campaign ?? null});
      const shown = startNode ? startNode.name : levelDisplayName(level, seeds[level]); // (task mall-playtest-revision, lane GEN: the seeded mall name)
      const ui = this.showLoading(shown, `Generating ${shown}…`); // (lane MENU, campaign polish item 9: the location name only)
      await nextPaint();
      let layout: StationLayout;
      try { layout = await this.prepareSection(key, run, this.progressTo(ui, 'Loading station props')); } catch (err) { this.lifecycleFailed(err, back, ui); return null; }
      await this.warmRun; // Iteration 14: never rebuild under a running warm-up (it owns the renderer state)
      this.leaveSection(false); // the old run is discarded (lane teardown still runs against it)
      this.run = run;
      this.resetCarry();
      this.buildSection(key, layout, {kind: 'start'}, true);
      this.run.entered.push(level);
      this.run.entry = this.levelEntrySnapshot();
      this.updateStationIntro();
      // Iteration 14: the new station's first-use graphics are prepared on the loading screen before play (pipelines
      // already built for the previous station are cache hits; new instanced meshes / models are not)
      const w = await this.prepareGraphics(ui);
      if (w.status === 'cancelled') return w; // the device was lost
      this.readyLine(ui, w);
      if (lock) void lock.then(() => this.enterPlay());
      return w;
    });
    return flight ?? Promise.resolve(null);
  }

  /**
   * Iteration 16 (RUN): RETRY LEVEL (death screen) — back to the snapshot taken when this logical level was entered: the
   * inventory, hp / stamina, hunger / thirst, battery, injuries and run stats as they were then, and the level's
   * sections as they were then. Nothing is healed or refilled beyond that state. Single flight.
   */
  retryLevel(): Promise<WarmupResult | null> {
    const snap = this.run.entry;
    if (!snap) return this.newGame(this.run.current.level, {enter: true});
    if (this.lifecycle.busy) return Promise.resolve(null);
    const lock = this.beginGesture();
    const flight = this.lifecycle.run(async () => {
      const key: SectionKey = snap.station ? {level: snap.level, section: snap.section, station: snap.station} : {level: snap.level, section: snap.section};
      const def = LEVELS[key.level];
      const place = (snap.station ? this.run.node?.(snap.station)?.name : undefined) ?? levelDisplayName(key.level, this.run.seeds[key.level]);
      const ui = this.showLoading(place, `Rebuilding ${def.name}…`); // (lane MENU, campaign polish item 9: the location name only)
      await nextPaint();
      let layout: StationLayout;
      try { layout = await this.prepareSection(key, this.run, this.progressTo(ui, 'Loading station props')); } catch (err) { this.lifecycleFailed(err, 'dead', ui); return null; }
      await this.warmRun;
      this.leaveSection(false); // this level's memories are replaced by the snapshot's
      this.run.restoreScopeMemories(key, snap.memories); // (campaign: this station's memories only)
      this.restoreCarryFrom(snap);
      this.buildSection(key, layout, snap.arrival, false); // (the loading screen keeps saying what Retry restores)
      const w = await this.prepareGraphics(ui);
      if (w.status === 'cancelled') return w;
      this.readyLine(ui, w);
      void lock.then(() => this.enterPlay());
      return w;
    });
    return flight ?? Promise.resolve(null);
  }

  /** Iteration 16: generating / preparing a section failed BEFORE the live world was touched: back to `back` (the error screen at boot). */
  private lifecycleFailed(err: unknown, back: GameState, ui: WarmupUi): void {
    console.error('Iteration 16: building a section failed', err);
    this.lastError = String((err as Error)?.stack ?? err);
    const msg = String((err as Error)?.message ?? err).slice(0, 160);
    ui.label.textContent = `Could not build that level (${msg})`;
    if (ui.button) ui.button.disabled = !this.world;
    if (!this.world) {
      $('#error-msg').textContent = `Building the level failed: ${msg}`;
      this.setState('error');
    } else this.setState(back === 'loading' ? 'title' : back);
  }

  /** Iteration 16: a travel is in flight. */
  get travelling(): boolean {
    return this.travelReq !== null;
  }
  private travelReq: TravelRequest | null = null;

  /**
   * Iteration 16 (RUN) / 17: TRAVEL to another LOGICAL level (the pause / clear menus). Nothing inside a level travels:
   * its storeys are one continuous world (stairs, the moving elevator). Single flight; refused when dead. Cancels
   * transient actions (timed use, flare hold, ADS, open UIs), saves the current level's memory, generates + builds the
   * target behind the full loading screen, applies its memory, places the player at its start (nothing about the player
   * is reset), runs the iteration-14 warm-up, then resumes play. Entering another level takes its Retry snapshot.
   */
  travel(req: TravelRequest): Promise<TravelResult> {
    this.lifecycleCounts.travel++;
    const refusal = travelRefusal(req, {
      busy: this.lifecycle.busy, alive: this.player.alive, state: this.state, ready: !!this.world && !!this.gpu,
      sections: l => LEVELS[l]?.sections(this.run.seeds[l]) ?? null, current: this.run.current.level,
    });
    if (refusal) return Promise.resolve({ok: false, reason: refusal});
    const lock = this.beginGesture(); // a menu click: pointer lock is requested inside the gesture
    const flight = this.lifecycle.run(async (): Promise<TravelResult> => {
      const from = {...this.run.current};
      const levelChange = req.to.level !== from.level;
      this.travelReq = req;
      this.cancelUse('travel');
      this.cancelFlareHold();
      this.aiming = false;
      const shown = levelDisplayName(req.to.level, this.run.seeds[req.to.level]); // (lane GEN: the seeded mall name)
      const ui = this.showLoading(shown, `Building ${shown} · ${sectionLabel(req.to)}…`); // (lane MENU, campaign polish item 9: the location name only)
      let built = false;
      try {
        await nextPaint();
        const layout = await this.prepareSection(req.to, this.run, this.progressTo(ui, 'Loading props'));
        await this.warmRun;
        this.leaveSection(true);
        built = true;
        this.buildSection(req.to, layout, req.arrival, false);
        if (levelChange) { this.run.entered.push(req.to.level); this.run.entry = this.levelEntrySnapshot(); }
        const w = await this.prepareGraphics(ui); // (a menu travel's loading screen keeps its carry-over line)
        if (w.status === 'cancelled') return {ok: false, reason: 'cancelled'};
        this.readyLine(ui, w);
        const ok = await lock;
        if (ok) await this.enterPlay();
        else this.setState('paused');
        if (this.state === 'paused') $('#pause .fine').textContent = 'The browser did not capture the mouse — click Resume to try again.';
        this.hud.toast(levelChange ? `${shown} · ${sectionLabel(req.to)} — your kit and condition came with you` : req.label);
        return {ok: true};
      } catch (err) {
        console.error('Iteration 16: travel failed', err);
        this.lastError = String((err as Error)?.stack ?? err);
        if (!built) { this.setState('paused'); $('#pause .fine').textContent = `Travel failed (${String((err as Error)?.message ?? err).slice(0, 120)}) — you are still here.`; }
        else { $('#error-msg').textContent = `Travel failed while building the next area: ${String((err as Error)?.message ?? err).slice(0, 160)}`; this.setState('error'); }
        return {ok: false, reason: 'failed'};
      } finally {
        this.travelReq = null;
      }
    });
    return flight ?? Promise.resolve({ok: false, reason: 'busy'});
  }

  /**
   * Iteration 14: a quality change (pause menu) rebuilds the atmosphere's targets — a new render context, so every
   * station pipeline would compile again on the first frames after Resume. Re-run the warm-up right here (progress in
   * the pause panel, Resume held until it finishes). Shader-affecting configuration changes call this hook.
   */
  async rewarmAfterSettings(): Promise<void> {
    if (!this.world || this.state !== 'paused') return;
    const line = $('#pause .fine'), resume = $('#btn-resume') as HTMLButtonElement;
    const was = line.textContent;
    const w = await this.prepareGraphics({meter: null, label: line, button: resume});
    const note = warmupNote(w);
    line.textContent = w.status === 'complete' || !note ? was : `${was} (${note})`;
  }

  /** Iteration 14: queue a GPU-side release of the previous station (run after the next warm-up). */
  private retire(fn: () => void): void {
    this.retired.push(fn);
  }

  /** Iteration 14: run the queued releases (after the new station's warm-up, or before the next teardown). */
  private flushRetired(): void {
    const list = this.retired;
    this.retired = [];
    for (const fn of list) {
      try { fn(); } catch (err) { console.warn('Iteration 14: releasing previous-station GPU resources failed', err); }
    }
  }

  /**
   * Task runtime-variant-warmup-20261105 (render/runtimeVariants.ts): (re)build the runtime-variant prototypes of the live world just
   * before a warm-up / the journey preparation plans it (the station is built, its shadow flags marked, its enemies spawned): holder
   * takeovers + aim highlights (world/containers.ts), damaged parts (damage/propDamage.ts), flesh chunks per enemy layer-material
   * variant (physics/chunks.ts). 'full' only: a software rasterizer's 'view' warm-up keeps its bounded neighbourhood (every variant's
   * programs would land in system RAM) and the pool is cleared. The pool supersedes the flag-less damage pre-warm meshes. A failure
   * leaves the pool empty (the warm-up runs as before); nothing of the world, its holders, loot, damage, physics or RNG changes.
   * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): + a pickup of every item (world/pickups.ts pickupPrototypes:
   * a dropped item, a lot shot off its holder or a stolen ware is a new object with its own material copies) and every moving set of
   * the shelf filler (world/shelfStockWarm.ts, the 'shelf-stock-moving' pool: made on the first piece of each archetype knocked loose).
   */
  private refreshRuntimeVariants(mode: WarmupMode): void {
    const retire = (fn: () => void) => this.retire(fn);
    if (mode !== 'full' || !this.world || !this.containers) { this.runtimeVariants.clear(retire); return; }
    try {
      const cm = this.containers.runtimeVariantPrototypes();
      const dmg = this.damage.props.variantPrototypes(cm.own);
      const layers: THREE.Material[] = [];
      for (const z of this.zombies) for (const l of woundsOf(z as unknown as Parameters<typeof woundsOf>[0])?.layers ?? []) layers.push(l.material);
      const flesh = this.physics.chunks.fleshPrototypes(layers);
      const pickup = this.pickups.pickupPrototypes(Object.keys(ITEMS)); // (lane PLAY: the variety weapons are their own pool's)
      const movingSets = prepareStockMovingSets(this.stock); // (lane PLAY: hidden, empty; the 'shelf-stock-moving' pool)
      this.damage.props.dropWarmup();
      const st = this.runtimeVariants.rebuild([
        {name: 'takeover', meshes: cm.takeover}, {name: 'highlight', meshes: cm.highlight}, {name: 'damaged', meshes: dmg.meshes}, {name: 'flesh', meshes: flesh.meshes},
        {name: 'pickup', meshes: pickup.meshes},
      ], {geometries: [...dmg.geometries, ...flesh.geometries], materials: pickup.materials}, retire);
      const f = st.families, n = (k: string) => `${f[k]?.kept ?? 0}/${f[k]?.offered ?? 0}`;
      console.info(`Terminal State: runtime variants ${st.prototypes} prototypes (${st.casters} casters, ${st.sideProxies} side copies) · takeover ${n('takeover')} · highlight ${n('highlight')} · damaged ${n('damaged')} · flesh ${n('flesh')} · pickup ${n('pickup')} · loot highlight copies ${cm.lotHighlights} · shelf moving sets ${movingSets} · ${st.ms.toFixed(1)} ms`);
    } catch (err) {
      console.warn('runtime variants: building the prototypes failed (the warm-up continues without them)', err);
      this.runtimeVariants.clear(retire);
    }
  }

  /**
   * Iteration 14: readiness boundary for content added AFTER the loading screen (render/warmup.ts prepareObjects): add
   * `root` to the scene hidden, await this, then show it. Things created on use that recur (effects, thrown items) should
   * instead be registered as warm-up pools / prototypes (warmRegistry) so the loading screen covers them.
   */
  prepareBeforeShow(root: THREE.Object3D): Promise<void> {
    const target = this.atmosphereBypass ? null : this.atmosphere.warmTarget(this.scene, this.camera);
    return prepareObjects(this.renderer as unknown as WarmupRenderer, this.scene, this.camera, root, target, this.sceneDepth(false));
  }

  /**
   * Task studio-performance-recorder-20261103 (lane RENDER-CPU): the render-context call depth the station's scene pass is drawn at
   * (render/renderContextDepth.ts: three r186 keys render contexts — and so node builds — by it; the atmosphere draws the station
   * inside its RenderPipeline). Measured once per scene-pass target with one hidden frame that draws nothing of the scene (camera
   * layers empty), only when `measure` (the warm-up: frames are held, the canvas is hidden for it); otherwise the known value or 0.
   * The direct path (no atmosphere target) is a top-level render: 0.
   */
  private sceneDepth(measure: boolean): number {
    const target = this.atmosphereBypass ? null : this.atmosphere.warmTarget(this.scene, this.camera);
    if (!target || typeof target !== 'object') return 0;
    const known = this.sceneDepths.get(target);
    if (known !== undefined) return known;
    if (!measure) return this.sceneDepthLast ?? 0; // (a rebuilt pipeline keeps its structure: the last measured depth)
    const mask = this.camera.layers.mask, shown = this.canvas.style.visibility;
    let depth: number | null = null;
    try {
      this.canvas.style.visibility = 'hidden';
      this.camera.layers.mask = 0; // (nothing of the scene draws; the pipeline's passes run as in a real frame)
      depth = renderContextDepth(this.renderer, target, () => this.drawFrame());
    } catch (err) {
      console.warn('lane RENDER-CPU: scene-pass depth probe failed; compiling at the top level', err);
    } finally {
      this.camera.layers.mask = mask;
      this.canvas.style.visibility = shown;
    }
    this.atmosphere.resetHistory();
    this.sceneDepths.set(target, depth ?? 0);
    if (depth !== null) this.sceneDepthLast = depth;
    return depth ?? 0;
  }

  /**
   * Iteration 14: the title / loading screen's station line (boot and restarts). Task studio-beta-campaign-polish-20261103-063841-01
   * (lane MENU, item 9): ONLY the location name (ui/loadingScreen.ts loadingPlaceName: the campaign node's name, else the layout's /
   * the mall's seeded name) — the infected count and the "clear them out" objective text are gone.
   */
  updateStationIntro(): void {
    const k = this.run.current;
    $('#station-intro').textContent = loadingPlaceName({
      node: k.station ? this.run.node?.(k.station) ?? null : null, level: k.level,
      layoutName: this.layout?.name, mallName: this.layout?.mall?.name, levelName: levelDisplayName(k.level, this.run.seeds[k.level]),
    });
  }

  /**
   * Iteration 14 (primary): the loading-screen render warm-up for the current station (render/warmup.ts) on the
   * backend / quality that will actually run, with its truthful progress on the loading screen's map. Single flight (a second
   * call while one runs gets the same promise); resolves (never rejects) once the renderer state is restored, with the
   * status — complete / partial (time budget) / cancelled (station replaced, device lost) / failed / skipped. Only
   * renderer-side preparation: no update tick, AI, physics, loot, battery / flare timers or sound. A later quality
   * change rebuilds the atmosphere's targets (a new render context), so those first frames compile again.
   */
  prepareGraphics(ui: WarmupUi = this.titleWarmupUi()): Promise<WarmupResult> {
    if (this.warmRun) return this.warmRun;
    const run = this.runWarmup(ui).finally(() => { this.warming = false; this.warmRun = null; this.flushRetired(); });
    this.warmRun = run;
    return run;
  }

  /**
   * Task track3-eaton-centre-20261031 (lane PERF): in the mall, upload the built level's model textures behind the loading screen
   * in byte-bounded batches (assets/textureRelease.ts stageUploads), each batch's decoded images released before the next one,
   * instead of the first frame uploading ~80 models' textures while every decoded copy is still resident (the load-time memory
   * peak on a software rasterizer). Frames are held meanwhile (`warming`); prepareGraphics' finally clears it. No-op elsewhere.
   */
  private async stageLevelTextures(ui: WarmupUi): Promise<void> {
    if (!this.layout?.mall || !this.world || !this.gpu || this.gpu.deviceLost || !this.renderer.initialized) return;
    const textures = new Set<THREE.Texture>();
    this.scene.traverse(o => collectTextures(o, textures));
    const gen = this.stationGen;
    this.warming = true;
    ui.label.textContent = 'Preparing textures…';
    await stageUploads(t => this.renderer.initTexture(t), textures, {
      progress: (done, total) => { ui.meter?.stage('textures', done / Math.max(1, total)); },
      alive: () => gen === this.stationGen && !this.gpu?.deviceLost,
    });
  }

  private async runWarmup(ui: WarmupUi): Promise<WarmupResult> {
    this.lifecycleCounts.warmup++;
    const {meter, label, button} = ui;
    await this.stageLevelTextures(ui); // Task track3-eaton-centre-20261031 (lane PERF): mall only; runs with ?warmup=off too
    const mode = warmupMode(location.search, this.softwareGl?.software === true);
    if (mode === 'off') return (this.warmup = skippedWarmup('disabled by ?warmup=off'));
    if (!this.world || !this.gpu || this.gpu.deviceLost || !this.renderer.initialized) return (this.warmup = skippedWarmup('renderer or station not ready'));
    this.refreshRuntimeVariants(mode); // task runtime-variant-warmup-20261105: the play-only variants join the plan (a pool)
    this.warming = true;
    if (button) button.disabled = true;
    // a quality change mid-run would dispose the render target being compiled into
    const quality = document.querySelector<HTMLSelectElement>('#set-quality');
    const qualityWas = quality?.disabled ?? false;
    if (quality) quality.disabled = true;
    meter?.stage('graphics', 0);
    label.textContent = 'Preparing graphics…';
    const gen = this.stationGen;
    const res = await runWarmup({
      renderer: this.renderer as unknown as WarmupRenderer,
      scene: this.scene, camera: this.camera, mode, registry: this.warmRegistry,
      near: {center: this.camera.getWorldPosition(new THREE.Vector3()), radius: 24},
      sceneTarget: () => this.atmosphereBypass ? null : this.atmosphere.warmTarget(this.scene, this.camera),
      torch: this.flashlight, torchIntensity: MOOD.flashlight,
      frame: () => this.drawFrame(),
      finish: () => { this.world.culler.update(this.camera, true); this.atmosphere.resetHistory(); this.render(); },
      hide: hidden => { this.canvas.style.visibility = hidden ? 'hidden' : ''; },
      alive: () => gen === this.stationGen && !this.gpu?.deviceLost,
      sceneDepth: () => this.sceneDepth(true), // lane RENDER-CPU: compile into the context the real frame draws the station in
    }, {
      onProgress: (p: WarmupProgress) => { meter?.stage('graphics', p.done / Math.max(1, p.total)); label.textContent = warmupLabel(p); },
    });
    this.warmup = res;
    const st = res.stages;
    if (button) button.disabled = false;
    if (quality) quality.disabled = qualityWas;
    console.info(`Terminal State: graphics warm-up ${res.status}${res.reason ? ` (${res.reason})` : ''} · ${res.mode} · ${(res.ms / 1000).toFixed(1)} s · `
      + `materials ${st.materials.done}/${st.materials.total} · passes ${st.passes.done}/${st.passes.total} · shadow frames ${st.shadows.done}/${st.shadows.total}`);
    return res;
  }

  /**
   * Iteration 07 (Lane Q): build + register one enemy for a spawn (zombie look or archetype actor).
   * Zombies wear a seeded body x outfit look (deterministic per station seed + spawn index; 'coated' =
   * heavy coat outfit), falling back to the legacy single template when no registry body is loaded.
   */
  /**
   * Task mall-lingerie-20261102-221554 (lane CONTEXT): the lingerie look library (lane FIT's createLingerieLibrary) over the boot models
   * (the pale bodies) + the loaded lazy garments; null while none is loaded. Rebuilt only when the loaded garment set changes.
   */
  private lingerieLookLibrary(models: Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF | undefined>): WardrobeLibrary | null {
    const lazy = Object.keys(LINGERIE_MODEL_FILES).sort().map(k => [k, this.propModels.get(k)] as const).filter(([, g]) => g);
    if (!lazy.length) return null;
    const c = this.lingerieLooks;
    if (c && c.models.length === lazy.length && c.models.every((g, k) => g === lazy[k][1])) return c.lib;
    const lib = createLingerieLibrary({...models, ...Object.fromEntries(lazy)});
    this.lingerieLooks = {models: lazy.map(([, g]) => g), lib};
    return lib;
  }

  /**
   * Task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the cosplay look library (ai/cosplay.ts createCosplayLibrary) over the
   * boot models (the bodies, the reused ordinary slacks) + the loaded lazy costume files; null while none is loaded. Rebuilt only when the
   * loaded set changes.
   */
  private cosplayLookLibrary(models: Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF | undefined>): WardrobeLibrary | null {
    const lazy = Object.keys(COSPLAY_MODEL_FILES).sort().map(k => [k, this.propModels.get(k)] as const).filter(([, g]) => g);
    if (!lazy.length) return null;
    const c = this.cosplayLooks;
    if (c && c.models.length === lazy.length && c.models.every((g, k) => g === lazy[k][1])) return c.lib;
    const lib = createCosplayLibrary({...models, ...Object.fromEntries(lazy)});
    this.cosplayLooks = {models: lazy.map(([, g]) => g), lib};
    return lib;
  }

  spawnEnemy(s: ZombieSpawn, i: number): EnemyActor {
    const {actor: z, fallback} = this.buildEnemyActor(s, i, this.currentSeed, this.rand);
    if (fallback) this.enemyFallbacks++;
    this.damage.installZombie(z); // Lane D: own wound-patched material clones (body + every wearable)
    this.blight.adopt(z); // Task track1-siren-blightbelly-20261031 (lane BLIGHT): a Blightbelly reports its single death to the burst (others: no-op)
    // Lane T: spawn on the local floor height; Lane B (iteration 08): of the spawn's own level
    z.brain.y = z.root.position.y = s.y ?? this.levels.grid(s.level ?? 0).floorAt(s.x, s.z);
    if (z.brain instanceof BbBrain) z.brain.pose.y = z.brain.y; // (BB: the pose its actor renders starts on that floor too)
    this.sirens.adopt(z, s, i); // Task track1-siren-blightbelly-20261031 (lane SIREN): dormant (+ vein patch) or remembered awake (others: no-op)
    if (z.brain instanceof ScreacherBrain) this.screacherBrains.push(z.brain); // (the listeners of worldNoise)
    this.zombies.push(z);
    this.scene.add(z.root);
    this.atmosphere.markShadows(z.root, false); // Lane F: enemies block the flashlight beam
    return z;
  }

  /**
   * The actor of spawn `s` (layout index `i`) of a layout seeded `seed`, built as spawnEnemy builds it — its look by chooseSpawnLook, the
   * lazily loaded enemy models — but registered nowhere; `rand` = the caller's stream. Task studio-corpse-chipper-fuel-20261110-235304-01
   * (lane CORPSE): also a carried body's rebuild at any station (world/corpses.ts buildBody, with its own stream: never this.rand).
   */
  buildEnemyActor(s: ZombieSpawn, i: number, seed: number, rand: () => number): {actor: EnemyActor; fallback: boolean} {
    const models = this.assets.models as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF | undefined>;
    const looks = (this.zombieLooks ??= new ZombieLookLibrary(models));
    // Task track1-siren-blightbelly-20261031 (lane BLIGHT): + the lazily loaded enemy models of this layout (ai/enemyModels.ts)
    return createEnemyActor(s, withEnemyModels(models, k => this.propModels.get(k)), rand, () => {
      // task mall-lingerie-20261102-221554 (lane CONTEXT): a spawn tagged look 'lingerie' (the mall lingerie store's variants only)
      // wears its fitted set (ai/lingerie.ts lingerieLook(seed, i), when buildable top + bottom); every other spawn the ordinary pick
      // (lane COSPLAY: + a spawn tagged look 'cosplay' — the Skyways convention's costumed zombies — wears its costume the same way)
      const special = s.look === 'lingerie' ? this.lingerieLookLibrary(models) : s.look === 'cosplay' ? this.cosplayLookLibrary(models) : null;
      const pick = looks.bodies.length ? chooseSpawnLook(seed, i, s, looks, special) : null;
      const source = pick ? (pick.library === 'ordinary' ? looks : special!).build(pick.look) : models.zombie;
      if (!source) throw new Error('no zombie body model loaded (registry bodies and legacy zombie-rigged.glb both missing)');
      return new ZombieActor(source, s, rand);
    });
  }

  // ---------------------------------------------------------------------------------------
  setState(s: GameState): void {
    if (this.gpu?.deviceLost) s = 'error'; // Iteration 13 (CORE): a lost device keeps the error screen up (nothing can render)
    const prev = this.state;
    this.state = s;
    // (task journey-compile-pacing-20261104) the journey's background compile ends with the run it prepares: the main menu, death,
    // a loading screen (load / new game / retry build a new world) or the error screen; pause / inventory / map only hold it
    if (s === 'title' || s === 'dead' || s === 'loading' || s === 'error') this.journeyCompile?.cancel();
    this.input.active = s === 'playing';
    if (s !== 'playing') { this.input.clear(); this.cancelUse(s); this.cancelFlareHold(); this.weapon.cancelSwing(); this.meleeShoves.clear(); } // lane KNIFE / FEEL: no stale windup / contact after a menu / death / loading (lane MELEE: nor a push)
    this.invUI.cancelDrag();
    hideTooltip(); // (task studio-ui-subway-maps-20261108-074144-01) every screen change takes the game tooltip with it
    for (const id of ['title', 'pause', 'inventory', 'death', 'win', 'error']) $('#' + id).classList.add('hidden');
    const screen: Partial<Record<GameState, string>> = {title: 'title', paused: 'pause', inventory: 'inventory', dead: 'death', won: 'win', error: 'error', loading: 'title'};
    if (screen[s]) $('#' + screen[s]).classList.remove('hidden');
    this.hud.show(s === 'playing' || s === 'paused' || s === 'inventory');
    // Only frozen menus silence audio; any other (incl. future overlay) state keeps it running.
    this.sfx.suspend(s === 'paused' || s === 'inventory' || s === 'title' || s === 'loading' || s === 'error');
    if (s === 'inventory') { this.invUI.selected = null; this.invUI.render(); }
    if (s !== 'playing' && prev === 'playing') this.input.unlock();
    this.lastFrame = performance.now();
    for (const fn of this.stateListeners) { try { fn(s, prev); } catch (err) { console.warn('Iteration 16: a state listener failed', err); } }
  }

  /** Called from a click (user gesture): audio + pointer lock, then play. */
  async enterPlay(): Promise<void> {
    this.sfx.init();
    this.sfx.setVolume(this.settings.volume);
    this.sfx.setMuted(this.settings.muted);
    const ok = await this.input.lock();
    this.setState(ok ? 'playing' : 'paused');
    if (!ok) $('#pause .fine').textContent = 'The browser did not capture the mouse — click Resume to try again.';
    else $('#pause .fine').textContent = 'Combat is frozen while this menu is open.';
  }

  private onKey(code: string): void {
    if (code === 'KeyM' && this.state !== 'loading') {
      this.settings.muted = !this.settings.muted;
      this.sfx.setMuted(this.settings.muted);
      ($('#set-mute') as HTMLInputElement).checked = this.settings.muted;
      this.onSettingsChanged?.('muted'); // (lane MENU: persisted by the settings store)
      if (this.state === 'playing') this.hud.toast(this.settings.muted ? 'Audio muted' : 'Audio on');
    }
    if (this.state === 'playing') {
      if (code === 'Tab' || code === 'KeyI') this.openInventory();
      // Browsers normally swallow Esc to exit pointer lock (handled by onLockChange); if the
      // page does receive it, pause directly.
      else if (code === 'Escape') this.setState('paused');
    } else if (this.state === 'inventory') {
      if (code === 'Tab' || code === 'KeyI' || code === 'Escape') this.closeInventory();
      const m = /^Digit([1-5])$/.exec(code);
      if (m) this.invUI.assign(Number(m[1]) - 1);
      else if (code === 'Backquote') this.invUI.assignMelee(); // lane SLOT: ~ puts the selected melee weapon into the melee slot
    } else if (this.state === 'paused' && code === 'Escape' && this.qa) {
      void this.enterPlay();
    }
  }

  openInventory(): void {
    this.cancelUse('inventory');
    this.setState('inventory');
  }

  /** Abort a timed use without consuming (slot switch, sprint, hit, menus, death); the gun comes back up. */
  private cancelUse(reason: string): void {
    if (!this.use) return;
    this.use = null;
    this.consumeView?.cancel(reason);
  }

  closeInventory(): void {
    void this.enterPlay();
  }

  // ---------------------------------------------------------------------------------------
  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    // task campaign-foundation-20261102 (lane MENU): the native ratio is the existing DPR cap (min(dpr, 1.5) on High; min(dpr, 1, 0.85)
    // on Low), times the linear render-resolution scale (Native / Half / Quarter) — ui/settingsStore.ts renderPixelRatio
    this.renderer.setPixelRatio(renderPixelRatio(window.devicePixelRatio || 1, this.settings.quality, this.settings.renderScale));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel?.setAspect(w / h);
    // Lane F: atmosphere quality follows the settings quality (?fog= overrides); targets track the drawing buffer.
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.atmosphere.setQuality(this.settings.quality);
    this.atmosphere.setSize(db.x, db.y);
    this.overlay.setSize(db.x, db.y); // Iteration 13 (CORE): viewmodel overlay target tracks the drawing buffer
  }

  applySettings(): void {
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.sfx.setVolume(this.settings.volume);
    this.sfx.setMuted(this.settings.muted);
    // task studio-perf-ao-train-continuity-20261110-022206-01 (lane AO): AO on / off is a uniform gate + the AO targets' size in the
    // atmosphere pass (?ao= wins): no existing program is rebuilt, nothing to re-warm; off -> on builds only the AO pass's own programs
    this.atmosphere.setAmbientOcclusion(this.settings.ambientOcclusion);
    this.resize();
  }

  /** One animation frame. `time` = its rAF timestamp (lane SCHED: display-rate detection; default: the callback's start). */
  frame(time?: number): void {
    this.prof.frameBegin(); // lane MEASURE (off: one boolean check)
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const cpu = this.frameCpu;
    cpu.updateMs = cpu.renderMs = cpu.deferredMs = 0;
    cpu.rendered = false;
    // Task frame-budget-deferral-20261030 (lane SCHED): background chunks run only in play. Held during the warm-up / loading
    // (their rAF intervals are not display samples either) and in every menu (the queue keeps its jobs; they do not age).
    const fb = this.frameBudget;
    fb.hold(this.warming ? 'warmup' : this.state === 'loading' ? 'loading' : this.state === 'playing' ? null : 'paused');
    fb.beginFrame(time ?? now, now);
    // Iteration 14: the warm-up owns the renderer (render target / layers / hidden frames) until it resolves
    if (this.warming) { this.input.endFrame(); return; }
    if (this.state === 'playing' || (this.state === 'won' && this.wonAt >= 0)) {
      const playing = this.state === 'playing';
      if (playing) this.update(dt);
      const r0 = performance.now();
      if (playing) cpu.updateMs = r0 - now;
      cpu.rendered = this.render();
      cpu.renderMs = performance.now() - r0;
      // lane SCHED: deferred chunks AFTER the critical update and the render submission, so the main-thread time this frame
      // already spent is measured, not predicted; still inside this callback, so the overlay's game CPU includes them
      // (deferredMs = their share). Nothing frame-critical is ever queued (see core/frameBudget.ts).
      this.prof.lap(SPAN.deferred); // lane MEASURE
      if (this.state === 'playing') cpu.deferredMs = fb.run();
      this.prof.lap(SPAN.other); // lane MEASURE
      this.frames++;
    } else if (this.menuRender && !this.world && (this.state === 'title' || this.state === 'loading')) {
      // task campaign-foundation-20261102 (lane MENU): the main menu's diorama (world/menuScene.ts; its own frame cap / hidden-tab pause)
      // until the first world is built — never a world update
      const r0 = performance.now();
      cpu.rendered = this.menuRender(time ?? now);
      cpu.renderMs = performance.now() - r0;
    } else if (this.world) {
      // menus: keep the frozen frame fresh at a low rate
      this.renderT -= dt;
      if (this.renderT <= 0) {
        this.renderT = 0.25;
        const r0 = performance.now();
        cpu.rendered = this.render();
        cpu.renderMs = performance.now() - r0;
      }
    }
    this.input.endFrame();
    this.prof.frameEnd(); // lane MEASURE: stores the frame when the world updated in it
  }

  /** Draws the frame; false when there is nothing to draw with (lost device / renderer not initialized). */
  render(): boolean {
    if (this.gpu?.deviceLost || !this.renderer.initialized) return false; // Iteration 13 (CORE): lost device / not initialized: nothing to draw with
    this.prof.lap(SPAN.cull); // lane MEASURE
    if (!this.transitGap) this.world?.culler.update(this.camera); // Iteration 08 (Lane G): level / fog culling (cheap; skipped while still); (lane BUILD) never in the transit gap: no station is live (a paced build is in progress)
    this.prof.lap(SPAN.draw); // lane MEASURE
    this.drawFrame();
    return true;
  }

  /** Iteration 14: the frame itself (station + atmosphere, then the viewmodel overlay); the warm-up's hidden frames call it without the culler. */
  private drawFrame(): void {
    if (this.gpu?.deviceLost || !this.renderer.initialized) return;
    this.renderer.info.reset();
    // Iteration 06 (Lane F): station scene + volumetric haze composited onto the canvas (direct r5 path when
    // off/unsupported); the viewmodel overlay is drawn on top afterwards, never fogged.
    // Iteration 13 (CORE): an atmosphere that throws on this renderer is bypassed (recorded, logged) -> direct scene render.
    if (!this.atmosphereBypass) {
      const sceneState = {background: this.scene.background, backgroundNode: this.scene.backgroundNode, fog: this.scene.fog};
      try {
        // (task studio-perf-ao-train-continuity-20261110-022206-01, lane PLAY: the station's world matrices once for the frame, not
        // again in the shadow pass / every pass drawing the scene — render/sceneMatrices.ts)
        drawWithSceneMatricesOnce(this.scene, () => this.atmosphere.render(this.scene, this.camera, this.time));
      } catch (err) {
        this.atmosphereBypass = `atmosphere render failed: ${String((err as Error)?.message ?? err).slice(0, 300)}`;
        if (this.gpu) recordGpuError(this.gpu, this.atmosphereBypass);
        console.error('Iteration 13: atmosphere render failed; rendering the station directly', err);
        // a pipeline that threw mid-pass may have left the output transform switched off (RenderPipeline does that per pass)
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.autoClear = false;
        // Iteration 13 (primary): three r186's ShadowNode.updateShadow has no finally. A throw inside the flashlight
        // shadow pass leaves its render-object function (casters only, shadow material), the override material, MRT /
        // render target and the scene's cleared background in place, and every later frame draws nothing. Put them back.
        this.renderer.setRenderObjectFunction(null);
        this.renderer.setMRT(null);
        this.renderer.setRenderTarget(null);
        this.renderer.setClearColor(0x000000, 1);
        Object.assign(this.scene, sceneState, {overrideMaterial: null});
        this.renderDirect();
      }
    } else this.renderDirect();
    // Iteration 13 (CORE): the viewmodel renders into its own target and is composited over the frame (render/overlay.ts),
    // replacing clearDepth() + a second canvas render (WebGPURenderer tone-maps in a separate output pass).
    if (OverlayPass.hasVisible(this.viewmodel.scene)) this.overlay.render(this.renderer, this.viewmodel.scene, this.viewmodel.camera);
  }

  /** Iteration 13 (CORE): the station straight to the canvas (scene background clears; the renderer's output pass tone-maps). */
  private renderDirect(): void {
    this.renderer.setRenderTarget(null);
    this.atmosphere.withGasFog(this.scene, () => this.renderer.render(this.scene, this.camera)); // task reactor-expansion-20261101 (lane GASLIGHT): toxic gas stays visible (in-engine fog fallback)
  }

  // ---------------------------------------------------------------------------------------
  private selectSlot(i: number): void {
    if (i === this.inv.selected && !this.inv.meleeSelected) return;
    const prev = this.heldNow();
    this.inv.select(i); // (leaves the melee slot)
    this.cancelUse('slot');
    this.syncHeld();
    this.noteSelection(prev);
  }

  /** Consumable return: what is held right now (the melee slot or a quick slot) and its stack. */
  private heldNow(): {melee: boolean; stack: ItemStack | null} {
    return {melee: this.inv.meleeSelected, stack: this.inv.selectedStack()};
  }

  /**
   * Consumable return: after a deliberate selection change. Switching TO a consumable from a held non-consumable remembers that item
   * (by uid); consumable -> consumable keeps the item originally switched from; any other choice (a gun, a flare, the knife, an empty
   * slot) is the player's newer choice and clears it.
   */
  private noteSelection(prev: {melee: boolean; stack: ItemStack | null}): void {
    const now = this.inv.selectedStack();
    if (!now || itemDef(now.itemId).kind !== 'consumable' || this.inv.meleeSelected) { this.consumeReturn = null; return; }
    if (prev.stack && prev.stack !== now && itemDef(prev.stack.itemId).kind !== 'consumable') this.consumeReturn = {melee: prev.melee, uid: prev.stack.uid, consumableUid: now.uid};
    else if (this.consumeReturn) this.consumeReturn.consumableUid = now.uid;
  }

  /**
   * Selection keys, once per playing frame: 1-5 quick slots; the wheel cycles quick slots 1-5 only (task knife-windup-20261030,
   * lane SLOT: from the melee slot it first returns to the remembered quick slot); ~ (Backquote; player/input.ts isMeleeKey drops
   * Ctrl / Alt / Meta combos and typing) draws the melee slot's weapon. (Q is the gas mask, not a selection key: gear/gasMask.ts.)
   */
  private slotKeys(inp: Pick<Input, 'hit' | 'wheel'>): void {
    for (let i = 0; i < 5; i++) if (inp.hit(`Digit${i + 1}`)) this.selectSlot(i);
    if (inp.wheel) { const i = this.inv.meleeSelected ? this.inv.selected : (this.inv.selected + Math.sign(inp.wheel) + 5) % 5; this.selectSlot(i); }
    if (inp.hit('Backquote')) this.selectMelee();
  }

  /**
   * Task knife-windup-20261030 (lane SLOT): ~ (Backquote) — draw the melee slot's weapon, like 1-5 draw a quick slot's. An empty
   * melee slot first takes a carried melee weapon (Inventory.refillMeleeSlot, like G and the grenade slot); with none anywhere:
   * "No melee weapon" and nothing changes (the held item stays; nothing stale is equipped). Already drawn: nothing to do.
   */
  selectMelee(): boolean {
    if (this.inv.meleeSelected) return true;
    if (!this.inv.melee && !this.inv.refillMeleeSlot()) { this.hud.toast('No melee weapon', true); this.sfx.denied(); return false; }
    this.inv.selectMelee();
    this.cancelUse('slot');
    this.syncHeld();
    this.consumeReturn = null; // (a deliberate draw of the melee weapon: nothing to return to)
    return true;
  }

  /** Equip whatever is in the selected quick slot (or the melee slot while it is selected: Inventory.selectedStack). */
  syncHeld(): void {
    const st = this.inv.selectedStack();
    const def = st ? itemDef(st.itemId) : null;
    if (def?.kind === 'weapon') {
      if (this.weapon.stack !== st) {
        // Lane KNIFE: a button held through a switch to / from the knife never fires or slashes the new weapon (release first)
        if (this.input.mouse[0] && (this.weapon.def?.melee || WEAPONS[def.weaponId!]?.melee)) this.lmbLatch = true;
        this.weapon.equip(st); this.sfx.equip();
      }
      this.viewmodel.setItem(st!.itemId);
    } else {
      this.weapon.equip(null);
      // Iteration 12 (LIGHT): a held flare shows; (task train-fuel-system, lane PORT) so does a supply with a registered held model (the fuel can)
      this.viewmodel.setItem(def?.kind === 'consumable' || def?.kind === 'throwable' || (def?.kind === 'supply' && this.viewmodel.hasItem(st!.itemId)) ? st!.itemId : null);
    }
    // Iteration 15: while a flare is readied the hand shows it (whatever pickups / inventory changes happen meanwhile)
    if (this.flareHold.active) { this.weapon.equip(null); this.viewmodel.setItem(this.throwItem ?? 'flare'); } // (the readied throwable: a flare or a crafted grenade)
    // Task office-overhaul-20261030 (INTERACT, #1): the readied backpack (6) is what the hands hold (gear/system.ts)
    else if (this.gear?.readied) { this.weapon.equip(null); this.viewmodel.setItem('backpack'); }
  }

  /** Iteration 15: drop a readied flare without throwing (nothing spent); the held item comes back. */
  private cancelFlareHold(): void {
    if (this.flareHold.cancel()) { this.throwItem = null; this.syncHeld(); }
  }

  /** Task studio-refinement-batch-20261113-035659-01: the hold's release throws the readied throwable — a flare or a crafted grenade. */
  private throwHeld(fromHeld: boolean): void {
    const id = this.throwItem ?? 'flare';
    this.throwItem = null;
    if (isGrenadeItem(id)) this.throwGrenade(fromHeld, id);
    else this.throwFlare(fromHeld);
  }

  /** A grenade-style press refused (nothing readied, nothing spent): one message per press. */
  private throwRefused(reason: 'none' | 'cap', itemId: string | null): void {
    const g = isGrenadeItem(itemId) ? itemDef(itemId) : null;
    if (reason === 'none') this.hud.toast(!itemId ? 'Nothing in the grenade slot — find a flare or craft a grenade' : g ? `No ${g.name}s left` : 'No flares — find one first', true);
    else this.hud.toast(itemId === ACID_GRENADE ? 'Three acid grenades already out — wait for a pool to dry up' : g ? 'Three lures already out — wait for one to run out' : 'Three flares already burning — wait for one to burn out', true);
    this.sfx.denied();
  }

  /**
   * Task studio-refinement-batch-20261113-035659-01: toss one crafted grenade (the grenade slot's, or the held one) — exactly one item is
   * removed, and only once the throw happened (weapons/grenades.ts throwOneGrenade; the throwFlare rule).
   */
  private throwGrenade(fromHeld: boolean, id: GrenadeId): void {
    const ref = fromHeld && this.inv.selectedStack()?.itemId === id ? this.inv.selectedRef()
      : !fromHeld && this.inv.thrown?.itemId === id ? THROW_REF : null;
    if (this.use || this.consumeView.busy || this.player.climbing) return;
    const p = this.player, def = itemDef(id);
    const r = throwOneGrenade(this.grenades, id, () => (ref ? this.inv.consumeAt(ref) : this.inv.take(id, 1) === 1), () => this.inv.count(id) > 0,
      this.camera.getWorldPosition(new THREE.Vector3()), this.forward(), {x: p.vx, y: p.grounded ? 0 : p.vy * 0.5, z: p.vz});
    if (!r.ok) {
      if (r.reason === 'none' || r.reason === 'cap') this.throwRefused(r.reason, id);
      return; // 'cooldown' (a double press) / 'unavailable': silent
    }
    this.stats.itemsUsed++;
    const left = this.inv.count(id);
    this.hud.toast(`${def.short} grenade thrown · ${left ? `${left} left` : 'last one'}`);
    this.viewmodel.setItem(null);
    this.syncHeld();
  }

  /**
   * Iteration 12 (LIGHT): strike + toss one flare (G: the grenade slot — INTERACT #6, was T from anywhere; left click with a flare held). Exactly one
   * item is removed, and only once the throw happened: at the cap / cooldown / without physics nothing is used (HUD message).
   */
  private throwFlare(fromHeld: boolean): void {
    // Task office-overhaul-20261030 (INTERACT, #6): G throws the grenade slot's flare; left click the held one
    const ref = fromHeld && this.inv.selectedStack()?.itemId === 'flare' ? this.inv.selectedRef()
      : !fromHeld && this.inv.thrown?.itemId === 'flare' ? THROW_REF : null;
    if (this.use || this.consumeView.busy || this.player.climbing) return;
    const p = this.player;
    // throwOneFlare: refused (cap / cooldown / no physics / none) -> nothing removed; else exactly one removed, then thrown
    const r = throwOneFlare(this.flares, () => (ref ? this.inv.consumeAt(ref) : this.inv.take('flare', 1) === 1), () => this.inv.count('flare') > 0,
      this.camera.getWorldPosition(new THREE.Vector3()), this.forward(), {x: p.vx, y: p.grounded ? 0 : p.vy * 0.5, z: p.vz});
    if (!r.ok) {
      if (r.reason === 'none') { this.hud.toast('No flares — find one first', true); this.sfx.denied(); }
      else if (r.reason === 'cap') { this.hud.toast('Three flares already burning — wait for one to burn out', true); this.sfx.denied(); }
      return; // 'cooldown' (a double press) / 'unavailable': silent
    }
    this.stats.itemsUsed++;
    const left = this.inv.count('flare');
    this.hud.toast(`Flare thrown · ${left ? `${left} left` : 'last one'}`);
    // the hands were busy: the held item / gun comes back up from below
    this.viewmodel.setItem(null);
    this.syncHeld();
  }

  /** Iteration 12 (LIGHT): F — switch click; with a flat battery the light stays off (dry click + hint, at most every 4 s). */
  private toggleFlashlight(): void {
    const r = this.torch.toggle();
    if (r !== 'dead') { this.sfx.click(1.4); return; }
    this.sfx.click(0.6);
    if (this.time - this.deadHintAt > 4) { this.deadHintAt = this.time; this.hud.toast(this.inv.count('battery') ? 'Flashlight battery is flat — use a battery' : 'Flashlight battery is flat — find a battery', true); }
  }
  private deadHintAt = -Infinity;

  /** Iteration 12 (LIGHT): battery / flicker -> SpotLight + body glow + their light sources; HUD warnings; flicker crackle. */
  private updatePlayerLight(dt: number, eye: THREE.Vector3): void {
    const p = this.player, L = this.levels;
    const ev = this.torch.update(dt, {
      sources: this.lightSources, eye, feet: {x: p.x, y: p.y, z: p.z}, yaw: p.yaw, level: L.levelAt(p.x, p.z, p.y + 0.05),
      raycast: (o, d, max) => raycastWorld(L, this.layout.props, o, d, max, this.layout.trench.floorY).t,
    });
    for (const e of ev) {
      if (e === 'low') this.hud.toast('Flashlight battery low — it will start to flicker', true);
      else if (e === 'critical') this.hud.toast('Flashlight battery almost flat', true);
      else if (e === 'died') { this.hud.toast(this.inv.count('battery') ? 'Flashlight battery died — use a battery' : 'Flashlight battery died', true); this.sfx.click(0.7); }
      else if (e === 'dip') this.sfx.flashlightFlicker?.(this.torch.battery.flicker);
    }
  }

  private equipRef(ref: SlotRef): void {
    // Task knife-windup-20261030 (lane SLOT): a melee weapon is equipped INTO the melee slot (a swap sends the one there to `ref`)
    // and drawn — it never takes a quick slot; the melee slot's own weapon is simply drawn (like ~).
    if (ref.bar === 'melee' || isMeleeItem(this.inv.get(ref)?.itemId)) {
      if (this.inv.equipMeleeFrom(ref) === 'refused') return;
      this.invUI.selected = MELEE_REF;
      this.selectMelee();
      return;
    }
    if (ref.bar === 'hotbar') { this.selectSlot(ref.index); return; }
    const wasMelee = this.inv.meleeSelected, prev = this.heldNow();
    this.inv.move(ref, {bar: 'hotbar', index: this.inv.selected});
    if (wasMelee) { this.inv.select(this.inv.selected); this.cancelUse('slot'); } // SLOT: the equipped gun is drawn
    this.invUI.selected = {bar: 'hotbar', index: this.inv.selected};
    this.syncHeld();
    this.noteSelection(prev); // (consumable return: an Equip is a deliberate selection too)
  }

  private forward(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }

  /** Drop `count` (default: all) of a slot on the floor in front of the player (inventory drag-out / Drop / Delete; G no longer drops). */
  dropRef(ref: SlotRef, count?: number): void {
    // task train-loose-cargo (user: "if I drop an item on the train it should come with it"): while riding, the stack lies on the car
    // floor in front of the player as the train's cargo (was: refused — "use the Lockbox")
    if (this.trainRide?.riding) {
      const st = this.inv.detach(ref, count);
      if (!st) return;
      if (this.use && !this.inv.find(this.use.uid)) this.cancelUse('dropped');
      const n = st.count;
      if (!this.trainCargo.dropRiding(st)) { this.inv.add(st); if (this.trainCargo.dropFull || this.trainRide.refuseDrop()) this.sfx.denied(); return; } // (no car view: as before; task cargo-overflow: a full floor says so itself)
      this.hud.toast(`Dropped ${n > 1 ? `${n} × ` : ''}${itemDef(st.itemId).short}`);
      this.syncHeld();
      return;
    }
    const st = this.inv.detach(ref, count);
    if (!st) return;
    if (this.use && !this.inv.find(this.use.uid)) this.cancelUse('dropped');
    const p = this.player, n = st.count;
    // Lane B (iteration 08) / Lane T: 0.9 m along the view on the player's own storey / floor, in sight (not through a railing / slab), on
    // its floor / tread, else at the player's feet. Task studio-refinement-batch-20261113-035659-01 (lane DROPS): + no collider box crossed,
    // and successive drops (the cans of a stack too) take a small bounded scatter round that point instead of one spot (world/dropScatter.ts)
    // task fuel-feedback: fuel cans lie as SINGLE cans (one visible can = one can; the quantity kept exactly)
    const cans = st.itemId === FUEL.canItem && n > 1;
    const spots = groundDropSpots({levels: this.levels, grid: this.layout.grid, propIndex: this.propIndex}, p, this.forward(), cans ? n : 1, this.pickups.list.map(pk => pk.obj.position));
    if (cans) {
      st.count = 1;
      this.pickups.add(st, spots[0].x, spots[0].y, spots[0].z, p.yaw);
      for (let k = 1; k < n; k++) { const one = this.inv.makeStack(FUEL.canItem, 1); one.count = 1; this.pickups.add(one, spots[k].x, spots[k].y, spots[k].z, p.yaw); }
    } else this.pickups.add(st, spots[0].x, spots[0].y, spots[0].z, p.yaw);
    this.hud.toast(`Dropped ${n > 1 ? `${n} × ` : ''}${itemDef(st.itemId).short}`);
    this.syncHeld();
  }

  private startUse(ref: SlotRef): void {
    const st = this.inv.get(ref);
    if (!st) return;
    const def = itemDef(st.itemId);
    if (def.kind !== 'consumable') return;
    if (this.gasMask.transitioning) return; // mask lane: no use starts while the gas mask goes on / comes off (H, click)
    if (this.skywaysCar?.refuseUse()) return; // (lane CAR) no item use while driving the Skyways car
    if (this.vomit?.active) return; // (lane SHELVES) no timed use starts while throwing up (H / a click)
    if (this.corpses?.refuseUse()) return; // (task corpse-chipper, lane CORPSE) no item use while the hands carry a body (H, the inventory)
    if (this.trainEquipment?.refuseUse()) return; // (task train-crafting, lane EQUIP) nor while they carry a storage chest
    // Iteration 12 (LIGHT): a battery is refused at >= 99 % charge (nothing used)
    // Iteration 16 (lane INJURY): a limb treatment needs its injury ("No leg injury to treat"); it heals no HP, so the HP check is skipped
    const blocked = (def.recharge ? this.torch.battery.refuseReason() : null)
      ?? (def.treats?.length ? this.injuries.refuseReason(def) : this.survival.blockReason(def, this.player.hp, this.player.maxHp));
    if (blocked) { this.hud.toast(`${blocked}${def.heal ? this.injuries.healNote() : ''}`); this.sfx.denied(); return; } // a bandage never fixes a limb
    const useTime = (def.useTime ?? 1) * this.mods.handlingMult; // Iteration 16 (lane GEAR): gloves x0.92 / arm injury (combined mods)
    const held = this.inv.selectedStack();
    this.use = {uid: st.uid, itemId: st.itemId, t: 0, total: useTime, ...(held === st && !this.inv.meleeSelected ? {held: {index: this.inv.selected}} : {})};
    // Consume view: the held gun/item lowers and this item's model comes up to the face.
    this.consumeView.start(st.itemId, useTime, held === st ? 'hand' : held ? 'swap' : 'empty');
    if (this.state === 'inventory') this.closeInventory();
  }

  /** A timed use reached its end: apply it (exactly once), then the item lowers and the held item — or, after a successful use of the held
   * consumable switched to from another item, THAT item (task mouse-axis-invert, consumable return) — comes back. */
  private completeUse(): void {
    const use = this.use;
    if (!use) return;
    const p = this.player;
    const ref = this.inv.find(use.uid);
    const def = itemDef(use.itemId);
    // Iteration 12 (LIGHT): a battery is applied by applyBatteryItem — refused at >= 99 % (nothing used), else exactly one removed
    const refused = def.recharge ? applyBatteryItem(this.torch.battery, () => !!ref && this.inv.consumeAt(ref), def.recharge) : null;
    if (refused) this.hud.toast(refused);
    // Iteration 16 (lane INJURY): a limb treatment re-checks its injury, is consumed exactly once and cures only its limbs
    const treat = def.treats?.length ? this.injuries.completeTreatment(def, () => !!ref && this.inv.consumeAt(ref)) : null;
    if (treat?.text) this.hud.toast(treat.text, !treat.ok);
    if (treat?.ok) { this.stats.itemsUsed++; this.sfx.heal(); }
    const used = treat ? false : def.recharge ? !refused : !!ref && this.inv.consumeAt(ref);
    if (used && def.recharge) {
      this.stats.itemsUsed++;
      this.sfx.batteryInsert?.();
      this.hud.toast(`Battery swapped in: flashlight ${this.torch.battery.percent} %${this.torch.battery.on ? '' : ' (F to switch on)'}`);
    } else if (used && (def.verb === 'eat' || def.verb === 'drink')) {
      // Food/drink: restore hunger/thirst (HUD bars animate up and pop "+N").
      // (task studio-market-bar-20261108-225231-01, lane BEER) a beer's effect is committed HERE, once, after its unit was consumed
      const beer = isBeer(def.id) ? this.beerEffects?.drink?.(def.id) : undefined;
      const d = beer === undefined ? this.survival.consume(def) : null;
      this.stats.itemsUsed++;
      if (def.verb === 'drink') this.sfx.drink(def.id); else this.sfx.eat(def.id);
      this.hud.toast(d ? `${def.verb === 'drink' ? 'Drank' : 'Ate'} ${def.name.toLowerCase()}: ${Survival.describe(d)}` : beer!);
    } else if (used) {
      const healed = p.heal(def.heal ?? 0);
      this.stats.healed += healed;
      this.stats.itemsUsed++;
      this.sfx.heal();
      this.hud.toast(`${def.short} used: +${Math.round(healed)} health${this.injuries.healNote()}`); // Iteration 16: HP only, never a limb
    }
    const ok = (!!treat && treat.ok) || used;
    const back = ok ? this.consumeReturnTarget(use) : null;
    // Item lowers away (or back into the hand while the held stack has units left), then the gun — or the item switched from — returns.
    this.consumeView.complete(!back && this.inv.selectedStack()?.uid === use.uid);
    this.use = null;
    if (back) this.returnToHeld(back); else this.syncHeld();
  }

  /**
   * Consumable return: after a SUCCESSFUL use of the held consumable that a deliberate switch selected. Units left in THAT stack (it is
   * still the selection): null and the return stays pending — the stack stays selected for the next use (a fresh press, as always), the
   * remembered item unchanged. That stack EMPTIED by this use: the item switched from — by uid, where it is selectable now: the melee
   * slot, or whichever quick slot holds it. Not found (dropped, stowed, pocketed, bagged): null, the current selection stays (never a stale
   * stack, never another item now in the old slot, never another stack of the same consumable). After the last unit nothing stays pending.
   */
  private consumeReturnTarget(use: UseAction): {melee: true} | {melee: false; index: number} | null {
    const r = this.consumeReturn;
    if (!r || !use.held || r.consumableUid !== use.uid) return null;
    // the player's newer choice wins: only while the consumable's slot is still the selection (a switch would have cancelled the use)
    if (this.inv.meleeSelected || this.inv.selected !== use.held.index) { this.consumeReturn = null; return null; }
    if (this.inv.selectedStack()?.uid === use.uid) return null; // units left in the used stack: it stays selected (still pending)
    this.consumeReturn = null;
    if (r.melee && this.inv.melee?.uid === r.uid) return {melee: true};
    const i = this.inv.hotbar.findIndex(st => st?.uid === r.uid);
    return i >= 0 ? {melee: false, index: i} : null;
  }

  /** Consumable return: select that item again; the button still held from the use never fires / swings it (released first: lmbLatch). */
  private returnToHeld(t: {melee: true} | {melee: false; index: number}): void {
    if (t.melee) this.inv.selectMelee(); else this.inv.select(t.index);
    this.syncHeld();
    if (this.input.mouse[0]) this.lmbLatch = true;
  }

  private quickHeal(): void {
    const missing = this.player.maxHp - this.player.hp;
    if (missing <= 0) { this.hud.toast(`Already at full health${this.injuries.healNote()}`); this.sfx.denied(); return; } // Iteration 16: limbs need a splint / sling
    const order = missing <= 25 ? ['bandage', 'medkit'] : ['medkit', 'bandage'];
    for (const id of order) {
      for (const bar of ['hotbar', 'pack'] as const) {
        const list = bar === 'hotbar' ? this.inv.hotbar : this.inv.pack;
        const i = list.findIndex(s => s?.itemId === id);
        if (i >= 0) { this.startUse({bar, index: i}); return; }
      }
    }
    this.hud.toast('No medical supplies', true);
    this.sfx.denied();
  }

  private interact(): void {
    if (this.vomit?.active) return; // (lane SHELVES) throwing up: no interaction until it is over
    for (const h of this.interactHandlers) if (h()) return; // Iteration 16: lane handlers first (grounded backpack, elevator, stair doors)
    if (this.containerTarget) { this.takeFromHolder(this.containerTarget); return; }
    const p = this.currentTarget;
    if (!p) {
      // Lane T (iteration 05): rescue ladder under the crosshair -> scripted climb (Space / S lets go).
      if (this.ladderAim && !this.player.climbing) {
        this.cancelUse('climb');
        this.player.startClimb(this.ladderAim.ladder, this.ladderAim.up);
        this.sfx.ladder(); // Lane S: Sound Lab ladder-rung clip
        this.ladderAim = null;
      }
      return;
    }
    const def = itemDef(p.stack.itemId);
    const before = p.stack.count;
    const prevSelectedEmpty = !this.inv.selectedStack();
    const left = this.inv.add(p.stack);
    if (left === before) { this.hud.toast('No room in inventory — drop something (Tab)', true); this.sfx.denied(); return; }
    this.sfx.pickup();
    const got = before - left;
    // (task studio-market-bar-20261108-225231-01, lane BEER) what went in and where it came from: the Pilsner's one acquisition hook (below)
    const taken = {...p.stack, count: got}, src = {kind: 'pickup' as const, layoutIndex: this.layoutPickup.get(p), lot: p.fromLot ? {holder: this.holderKeyBySerial(p.fromLot.holder), lot: p.fromLot.lot} : undefined};
    if (left > 0) { p.stack.count = left; this.hud.toast(`Took ${got} ${def.short} (no room for ${left})`); }
    else {
      this.pickups.remove(p);
      const ref = this.inv.find(p.stack.uid);
      if (def.kind === 'weapon' && ref?.bar === 'hotbar') {
        this.hud.toast(`${def.short} → quick slot ${ref.index + 1}${prevSelectedEmpty ? '' : ` (press ${ref.index + 1})`}`);
        if (prevSelectedEmpty) { this.selectSlot(ref.index); }
      } else if (ref?.bar === 'melee') { // lane SLOT: a melee weapon fills the empty melee slot
        this.hud.toast(`${def.short} → melee slot${prevSelectedEmpty ? '' : ' (press ~)'}`);
        if (prevSelectedEmpty) this.selectMelee();
      } else this.hud.toast(def.kind === 'weapon' ? `${def.short} stored in backpack` : `+${got} ${def.name}`);
    }
    this.beerEffects?.acquired?.(src, taken); // (lane BEER) a generated / lot-origin pickup only: the player's own drops have no origin
    this.syncHeld();
  }

  /**
   * [E] on a holder / its aimed lot (ContainerManager.interact, unchanged). Task studio-market-bar-20261108-225231-01 (lane BEER): while
   * Lucky Switch Pilsner is active, every lot this gave up (whole or in part: its count before vs after) goes through the one acquisition
   * hook as the default stack the lot became (items/loot.ts transferLot: makeStack).
   */
  private takeFromHolder(t: ContainerTarget): void {
    const h = t.container, luck = this.beerEffects?.active?.effect === 'pickup';
    const before = luck ? h.state.lots.map(l => ({id: l.id, itemId: l.itemId, count: l.count})) : null;
    this.containers?.interact(t);
    if (!before) return;
    for (const b of before) {
      const n = b.count - (h.state.lots.find(l => l.id === b.id)?.count ?? 0);
      if (n <= 0) continue;
      const st = this.inv.makeStack(b.itemId, 1);
      st.count = n; // (a lot may hold more than one stack: the exact count taken)
      this.beerEffects?.acquired?.({kind: 'lot', holder: holderKeyOf(h), lot: b.id}, st);
    }
  }

  /** (task studio-market-bar-20261108-225231-01, lane BEER) A holder's run-memory key by its serial (Pickup.fromLot provenance). */
  private holderKeyBySerial(serial: number): string {
    const h = this.containers?.all[serial];
    return h ? holderKeyOf(h) : `holder#${serial}`;
  }

  /**
   * Container feedback (open/close start, search results). Audio hook: wire the audio lane's
   * sfx.containerOpen / containerClose / search here on e.type 'open' | 'close' | 'search'.
   */
  private onContainerEvent(e: ContainerEvent): void {
    if (e.message) this.hud.toast(e.message, e.warn);
    // Iteration 08 (Lane I): openables name an existing holder's door cues (Sound Lab bank reused) and are rate-limited.
    const sound: string = e.sound ?? e.container.kind, cp = e.container.prop;
    const at = {x: cp.x, y: cp.y + cp.h * 0.5, z: cp.z};
    const door = e.type !== 'open' && e.type !== 'close' || this.doorSounds.allow(e.container.serial, this.time);
    if (e.type === 'spill') {
      for (const s of e.spilled ?? []) {
        const st = this.inv.makeStack(s.lot.itemId, s.lot.count);
        st.count = s.lot.count; // finite: the same lot (id kept as provenance), never re-rolled
        this.pickups.addAt(st, s.matrix, {holder: e.container.serial, lot: s.lot.id});
      }
    } else if (e.type === 'open') { if (door) this.sfx.containerOpen(sound, at); if (e.rummage !== false && door) this.sfx.search(); }
    else if (e.type === 'close') { if (door) this.sfx.containerClose(sound, at); }
    // an openable's item / chunk collision follows its open compartments (world/containers.ts openPhysicsBoxes)
    if ((e.type === 'open' || e.type === 'close') && e.container.open) this.physics.propsChanged(cp.x, cp.z);
    else if (e.type === 'search') this.sfx.pry(sound, at); // Lane S: pry start (vending): strain + latch snap
    if (e.result?.taken.length) { this.sfx.pickup(); this.syncHeld(); }
    else if (e.result?.remaining.length) this.sfx.denied();
  }

  private currentTarget: ReturnType<PickupManager['target']> = null;
  /** Lane T: rescue ladder under the crosshair within reach ([E] climbs up / down). */
  ladderAim: {ladder: Ladder; up: boolean; t: number} | null = null;
  containers: ContainerManager | null = null;
  private containerTarget: ContainerTarget | null = null;
  private readonly doorSounds = new SoundGate();

  currentSpread(def: WeaponDef): number {
    const moving = Math.min(1, this.player.speed / WALK_SPEED);
    const base = baseSpread(def, this.aiming, this.weapon.def === def ? this.weapon.settleSpread : 0); // (weapon variety, lane GUNS: + an AimSettle)
    return (base + def.spreadMove * moving * (this.aiming ? 0.4 : 1) + this.bloom + (this.player.sprinting ? 0.05 : 0)) * stanceSpreadMult(this.player.crouched)
      * this.mods.spreadMult; // Iteration 16: gloves / arm injury
  }

  // ---------------------------------------------------------------------------------------
  update(dt: number): void {
    const prof = this.prof; // lane MEASURE: profiler laps tile the update (off: one boolean check each)
    prof.lap(SPAN.input);
    this.time += dt;
    this.stats.time += dt;
    if (this.run.campaign) this.run.playtime += dt; // (campaign) save metadata
    // (campaign, primary) between the old world's teardown and the next one's build only the riding car exists: no world system runs
    if (this.transitGap) { this.updateTransitGap(dt); return; }
    this.campaignTick(dt);
    this.mods = combineModifiers(this.modifierSources); // Iteration 16: gear + injuries, from base values every frame
    const inp = this.input;
    const p = this.player;
    applyMouseLook(p, inp.dx, inp.dy, this.settings, this.aiming ? this.weapon.def?.aimLook ?? 0.65 : 1); // task mouse-axis-invert: sensitivity (x 0.65 aiming; a scoped gun's own aimLook: weapon variety), X / Y inverts, pitch clamp

    this.slotKeys(inp); // 1-5 / wheel / ~ (melee slot)
    if (inp.hit('KeyQ')) this.gasMask.press(); // Task gasmask-breach-20261030 (mask lane): Q = gas mask on / off (last-item cycling removed)
    if (inp.hit('KeyF') && !this.skywaysCar?.onLightKey()) this.toggleFlashlight(); // Iteration 12 (LIGHT): battery-aware (flat: dry click only); seated in the Skyways car: its lamps instead
    // Task office-overhaul-20261030 (lane INTERACT, #6): G = the grenade slot (hold / release below; T a silent alias). The old
    // G = drop binding is gone (drop by dragging out of the inventory screen). An empty grenade slot takes a carried throwable first.
    if ((inp.hit('KeyG') || inp.hit('KeyT')) && !this.inv.thrown && this.inv.refillThrowSlot()) this.syncHeld();
    if (inp.hit('KeyH')) this.quickHeal();
    if (inp.hit('KeyE')) this.interact();
    // Task office-overhaul-20261030 (lane LIFT): a left click on an in-world button under the crosshair (elevator) belongs to that
    // button: the press is consumed and latched until release — no shot, flare, item use or backpack placement below / in the hooks.
    if (inp.mousePressed[0] && this.pointerHandlers.some(h => h())) { inp.mousePressed[0] = false; this.lmbLatch = true; }

    prof.lap(SPAN.player);
    const held = this.inv.selectedStack();
    const heldDef = held ? itemDef(held.itemId) : null;
    const wdef = heldDef?.kind === 'weapon' ? WEAPONS[heldDef.weaponId!] : null;
    // Iteration 15: flares are readied while G (INTERACT #6; was T) / left click (flare in hand) is held and thrown on release (weapons/flareHold.ts)
    const laneOwns = this.inputOwners.some(f => f()); // Iteration 16 (lane GEAR): a readied / open backpack owns the mouse buttons
    // (lane RIDE) riding the moving train: no gunfire / melee / flare throws (the world's hitscan / bodies would not match the moving
    // car); aiming, reloading, consumables, gear, inventory, the flashlight and the Lockbox stay usable
    const rideHolster = this.trainRide.blocksWeapons;
    // task fuel-feedback: a lane giving the mouse back with the left button still held (a fuel pour ends / is cancelled, a backpack is
    // put away) never bleeds into the gun — the button is released first (as after a flare)
    if (this.laneOwnedLast && !laneOwns && inp.mouse[0]) this.lmbLatch = true;
    this.laneOwnedLast = laneOwns;
    if (this.lmbLatch && !inp.mouse[0]) this.lmbLatch = false;
    // (task studio-refinement-batch-20261113-035659-01) the SAME hold throws whichever throwable it readies: the grenade slot's (G) or the
    // held one (click) — a road flare or a crafted acid / lure grenade (throwItem; Game.throwHeld dispatches by item id)
    const keyThrow = inp.hit('KeyG') || inp.hit('KeyT');
    const tItem = throwHoldTarget({active: this.flareHold.active, readied: this.throwItem, keyPressed: keyThrow, slot: this.inv.thrown?.itemId ?? null,
      mousePressed: inp.mousePressed[0], held: held?.itemId ?? null, heldThrowable: heldDef?.kind === 'throwable'});
    for (const e of this.flareHold.update(dt, {
      keyDown: inp.down('KeyG') || inp.down('KeyT'), keyPressed: keyThrow, mouseDown: inp.mouse[0], mousePressed: inp.mousePressed[0], // INTERACT (#6): G
      heldIsFlare: heldDef?.kind === 'throwable' && (this.flareHold.source !== 'mouse' || held?.itemId === this.throwItem), busy: !!this.use || this.consumeView.busy || p.climbing || laneOwns || rideHolster,
      flares: tItem ? this.inv.count(tItem) : 0, refusal: tItem && isGrenadeItem(tItem) ? this.grenades.refusal(tItem) : this.flares.refusal(), clears: inp.clears,
    })) {
      if (e.type === 'ready') { this.throwItem = tItem; this.weapon.equip(null); this.viewmodel.setItem(tItem ?? 'flare'); }
      else if (e.type === 'release') this.throwHeld(e.source === 'mouse');
      else if (e.type === 'cancel') { this.throwItem = null; this.syncHeld(); }
      else this.throwRefused(e.reason, tItem);
      if ((e.type === 'release' || e.type === 'cancel') && inp.mouse[0]) this.lmbLatch = true; // never bleeds into the gun
    }
    const flareOwns = this.flareHold.active || this.lmbLatch || laneOwns;
    if (rideHolster && !flareOwns && ((inp.mousePressed[0] && (wdef || heldDef?.kind === 'throwable')) || inp.hit('KeyG') || inp.hit('KeyT'))) this.trainRide.refuseFire(); // (lane RIDE) the note
    // A fresh sprint (Shift while moving forward) interrupts a timed use. Until the consume view has
    // brought the gun back up it stays lowered: no aiming, firing or reloading.
    if (this.use && (inp.hit('ShiftLeft') || inp.hit('ShiftRight')) && (inp.down('KeyW') || inp.down('ArrowUp'))) this.cancelUse('sprint');
    const vmBusy = !!this.use || this.consumeView.busy || !!this.vomit?.active; // (lane SHELVES: throwing up — no aim / reload, the gun lowered)
    this.aiming = !!wdef && !wdef.melee && inp.mouse[2] && !this.weapon.reloading && !p.sprinting && !vmBusy && !p.climbing && !this.flareHold.active && !laneOwns;
    const moveOpts = {aiming: this.aiming, speedMult: (this.use ? 0.6 : wdef?.moveMult ?? 1) * this.mods.speedMult, canSprint: !this.use && !inp.mouse[0]};
    // (lane RIDE) riding: car pose -> the player's car-local step -> the world pose (TrainRide.stepPlayer); else the world body as ever
    // (lane CAR) driving the Skyways prize car: the car's step puts the player in the driver seat (world/skywaysCar.ts stepPlayer)
    const step = this.trainRide.riding ? this.trainRide.stepPlayer(dt, inp, moveOpts) : this.skywaysCar.driving ? this.skywaysCar.stepPlayer(dt, inp) : p.update(dt, inp, this.levels, this.propIndex, moveOpts);
    if (step) this.sfx.footstep(p.sprinting, p.crouched);
    if (p.justJumped) this.sfx.jump();
    if (p.justLanded) this.sfx.land(Math.min(1, p.landSpeed / 6));
    // (task studio-screacher-production-20261110-221858-01) the player's own QUALIFYING sounds for the blind Screacher: a sprinting
    // footstep and a real landing (walking, crouch-walking and standing still make none: sneaking past stays possible). The player's
    // one detectability factor applies as it does to gunfire (lane BEER: Night Shift Porter).
    if (this.screacherBrains.length && !this.trainRide.riding && !this.skywaysCar.driving) {
      const k = this.beerEffects?.perceptionMult() ?? 1;
      if (step && p.sprinting) this.worldNoise(p.x, p.y, p.z, SCREACHER_NOISE.run * k, 'run');
      if (p.justLanded) this.worldNoise(p.x, p.y, p.z, landNoise(p.landSpeed) * k, 'land');
    }
    if (p.justRung) this.sfx.ladder(); // Lane T: hand/foot on a ladder rung (Lane S: Sound Lab rung clip)
    if (p.stanceChanged) this.sfx.crouch(p.crouched);

    prof.lap(SPAN.weapon);
    if (wdef && !this.flareHold.active) {
      // Lane KNIFE / FEEL (knife-windup-20261030): a melee weapon winds up while held and swings on release. A lane UI taking the
      // buttons, or the button being latched away from it mid-windup, cancels (never a release that swings); wiped input
      // (`clears`: menus / blur / pointer unlock) cancels a windup too. `pressed` is Input's per-frame latch: a down + up inside
      // one frame still starts the full windup -> swing -> recovery.
      const ev = this.weapon.update(dt, {held: inp.mouse[0] && !flareOwns && !rideHolster, pressed: inp.mousePressed[0] && !flareOwns && !rideHolster, reload: inp.hit('KeyR') && !vmBusy && !this.skywaysCar.driving && !this.trainEquipment?.carrying && !this.trainEquipment?.dragging && !this.corpses?.carrying, // (lane RIDE: holstered; lane CAR: no reload while driving; lane DRAG: R turns a dragged device round instead)
        aiming: this.aiming, lowered: p.sprinting || vmBusy || p.climbing || (!!wdef.melee && (laneOwns || (this.lmbLatch && this.weapon.winding))), clears: inp.clears}, this.inv); // (lane GUNS: + aiming, an AimSettle)
      for (const e of ev) {
        // (task hitch-attribution-recorder-20261105: weapon.fire / weapon.melee spans — timing only, a no-op unless profiling)
        if (e.type === 'fire') { prof.begin(SPAN.fire); this.fire(e.def); prof.end(SPAN.fire); }
        else if (e.type === 'windup') { /* lane FEEL: the raise is silent (no whoosh while held); the viewmodel shows it */ }
        else if (e.type === 'swing') this.sfx.meleeSwing(); // lane KNIFE / FEEL: the whoosh at the RELEASE (no gunfire, bullets, flash or recoil)
        else if (e.type === 'contact') { prof.begin(SPAN.melee); this.meleeContact(e.def); prof.end(SPAN.melee); }
        else if (e.type === 'dry') { this.sfx.dry(e.def.sound); if (e.def.caliber && reserveFor(e.def, this.inv) === 0) this.hud.toast(`Out of ${caliberLabel(e.def)} ${CALIBERS[e.def.caliber].unit[1]}`, true); }
        else if (e.type === 'reloadStart') this.sfx.reloadStart(e.def.reloadCue ?? e.def.sound, e.empty, reloadCueTime(e.def, e.empty), e.def.id); // (lane GUNS: the gun's cue set + timing; + its own reload cues by id)
        else if (e.type === 'shellIn') { this.sfx.shellIn(); this.viewmodel.shellBump(); }
        else if (e.type === 'eject') this.viewmodel.ejectHulls(e.def, e.hulls); // (task turnstile-reload-visuals) the fired hulls fly out of the open cylinder
        else if (e.type === 'reloadEnd') { if (e.def.reload.kind === 'break') this.sfx.breakClose(e.def.sound, e.def.id); else this.sfx.reloadEnd(e.def.reloadCue ?? e.def.sound); } // (lane GUNS: a break action closes — its own barrels-shut cue by id, else a click)
      }
    } else if (heldDef?.kind === 'consumable' && inp.mousePressed[0] && !this.use && !flareOwns) {
      this.startUse(this.inv.selectedRef());
    }
    this.stepMeleeShoves(dt); // lane MELEE (weapon variety): heavy melee pushes, bounded, never through walls / off the floor

    if (this.use) {
      this.use.t += dt;
      if (this.use.t >= this.use.total) this.completeUse();
    }

    // Hunger/thirst: drain in play time only (menus freeze it); at 0, slow health loss (5 % of max HP per active minute) and the pain
    // grunt at most once a minute (task studio-alpha-survival-controls-20261107-060450-01)
    prof.lap(SPAN.survival);
    const surv = this.survival.update(survivalTicks(this.state) ? dt : 0, p.maxHp);
    if (surv.hpLoss > 0) p.takeDamage(surv.hpLoss);
    if (surv.pain && p.alive) this.sfx.hurt();
    for (const w of surv.warnings) this.hud.toast(w.text, w.warn);

    prof.lap(SPAN.ai);
    this.updateZombies(dt);
    prof.lap(SPAN.hooks);
    // Iteration 16: lane per-frame systems (gear / backpack, injuries, elevator); lane MEASURE: each timed in its own hook span
    let hookIx = 0;
    for (const fn of this.frameHooks) { const h = SPAN.hook0 + Math.min(hookIx++, HOOK_SLOTS - 1); prof.begin(h); fn(dt); prof.end(h); }
    prof.lap(SPAN.physics);
    this.physics.update(dt); // ragdolls (fixed 1/60 steps) + casings; update() only runs while playing
    prof.lap(SPAN.flares);
    this.flares.tick(dt); // Iteration 12 (LIGHT): flare bodies -> mesh / light / smoke / sound / light-source positions, burn-out
    this.scents.tick(dt); // lane LURE: the lure scents' ACTIVE seconds (update() never runs paused / in menus / loading)
    this.grenades.tick(dt); // task studio-refinement-batch-20261113-035659-01: canisters, bursts, acid pools (active seconds only), lures

    prof.lap(SPAN.camera);
    // recoil recovery and bloom decay
    const rec = wdef ? wdef.recoil.recover : 8;
    this.recoilPitch -= this.recoilPitch * Math.min(1, rec * dt);
    this.recoilYaw -= this.recoilYaw * Math.min(1, rec * dt);
    this.bloom = Math.max(0, this.bloom - dt * bloomDecay(wdef)); // (lane GUNS: a def's own Bloom recovery; else the shared 0.06)
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.updateCamera(dt);

    prof.lap(SPAN.targets);
    // (task studio-perf-ao-train-continuity-20261110-022206-01, lane PLAY: the frame's eye / look in scratch vectors, no new ones a frame)
    const eye = this.camera.getWorldPosition(this.frameEye);
    const look = this.forward(this.frameLook);
    const reachWorld = this.levels.count > 1 ? this.levels : this.layout.grid; // Lane B: 3D occlusion on stacked levels
    // (lane RIDE) from the moving car nothing of the station is in reach (the car's walls are not in the station's occlusion)
    const reachEye = this.trainRide.riding ? this.farEye : eye;
    this.currentTarget = this.pickups.target(reachEye, look, reachWorld);
    // Containers under the crosshair within reach; a closer targeted floor pickup wins.
    const tp = this.currentTarget;
    this.containerTarget = this.containers?.target(reachEye, look, reachWorld, tp ? Math.hypot(tp.x - eye.x, tp.y + 0.08 - eye.y, tp.z - eye.z) : Infinity) ?? null;
    // Iteration 07 (Lane K): a loose item resting INSIDE a holder's box (shot down to a lower shelf tier) wins over the holder body.
    const ct = this.containerTarget;
    if (ct && !ct.lot && tp && tp.x > ct.container.min.x && tp.x < ct.container.max.x && tp.z > ct.container.min.z && tp.z < ct.container.max.z && tp.y + 0.08 < ct.container.max.y) this.containerTarget = null;
    // Container wins: clear the pickup target + its highlight (an unreachable eye matches nothing).
    if (this.containerTarget && tp) this.currentTarget = this.pickups.target(this.farEye, look, reachWorld);
    // Lane T: a rescue ladder under the crosshair (only when nothing else is targeted).
    this.ladderAim = !this.currentTarget && !this.containerTarget && !p.climbing && !this.trainRide.riding ? ladderTarget(this.layout.traversal.ladders, eye, look, p.y) : null; // (lane RIDE: none from the moving car)
    prof.lap(SPAN.items);
    this.pickups.update(this.time);
    this.containers?.update(dt, this.time);

    prof.lap(SPAN.lights);
    this.muzzleT -= dt;
    this.muzzleLight.intensity = this.muzzleT > 0 ? 18 * (0.65 + Math.random() * 0.7) : 0; // flicker
    this.updatePlayerLight(dt, eye); // Iteration 12 (LIGHT): battery drain / flicker -> SpotLight, body glow, light sources
    this.lightPool.update(dt, eye);
    prof.lap(SPAN.fx);
    this.fx.update(dt);
    // Track 2 (VIS): annex steam near the player (visual only), lit by the light field + the torch.
    if (this.steamVents?.count) this.steamVents.update(dt, eye, steamLight((x, y, z) => this.lightPool.sample(x, y, z), {eye, dir: look, on: this.torch.battery.emitting}));
    this.world.trackExt?.machines.update(this.time); // Track 2 round 2 (lane MOTION): annex water flow + wall-fan rotors, game clock
    this.damage.update(dt); // Lane D: debris physics, knocked pickups
    prof.lap(SPAN.audio);
    // Audio: listener follows the camera; reverb room + ambience beds follow the current area.
    this.sfx.setListener(eye.x, eye.y, eye.z, p.yaw);
    const audioArea = this.layout.areas[this.levels.count > 1 ? this.levels.areaAt(p.x, p.z, p.y) : this.layout.grid.areaAt(p.x, p.z)];
    if (audioArea) this.sfx.setRoom(roomKindFor(audioArea), ambienceTypeFor(audioArea)); // Track 2 (VIS): tunnels -> track bed
    this.sfx.vitals(dt, p.hp / p.maxHp, p.stamina / 100);
    this.sfx.ambience(dt);
    // viewmodel brightness follows nearby light
    this.viewmodel.setLightLevel(this.lightPool.viewLevel(eye, this.torch.battery.emitting)); // Iteration 12 (LIGHT): actual output
    prof.lap(SPAN.view);
    this.consumeView.update(dt); // item-to-face pose + gun holster level, before the gun pose
    if (this.skywaysCar.holster > 0) this.viewmodel.setHolstered(this.skywaysCar.holster); // (lane CAR) hands on the wheel: the held item lowered
    const vomitHolster = this.vomitAction?.holster ?? 0; // (lane SHELVES) throwing up: the held item lowered (whichever lowers it more wins)
    if (vomitHolster > 0) this.viewmodel.setHolstered(Math.max(vomitHolster, this.consumeView.holster, this.skywaysCar.holster));
    const carryHolster = this.corpses?.holster ?? 0; // (task corpse-chipper, lane CORPSE) carrying a body: the held item lowered too (whichever lowers it more wins)
    if (carryHolster > 0) this.viewmodel.setHolstered(Math.max(carryHolster, vomitHolster, this.consumeView.holster, this.skywaysCar.holster));
    const chestHolster = this.trainEquipment?.holster ?? 0; // (task train-crafting, lane EQUIP) carrying a storage chest: the same lowering
    if (chestHolster > 0) this.viewmodel.setHolstered(Math.max(chestHolster, carryHolster, vomitHolster, this.consumeView.holster, this.skywaysCar.holster));
    this.viewmodel.update(dt, {
      // (task mouse-axis-invert: the sway follows the EFFECTIVE turn, so an inverted axis sways with the view, not against it)
      moving: Math.min(1, p.speed / WALK_SPEED), sprint: p.sprinting, aiming: this.aiming, lookDX: inp.dx * lookSigns(this.settings).x, lookDY: inp.dy * lookSigns(this.settings).y,
      reloading: this.weapon.reloading, reloadProgress: this.weapon.progress, using: !!this.use, useProgress: this.use ? this.use.t / this.use.total : 0, bobT: p.bobT,
      crouch: p.crouchBlend, vy: p.grounded ? 0 : p.vy, landDip: p.landDip,
      throwReady: this.flareHold.ready01, // Iteration 15: grenade-style pull-back
      melee: this.weapon.meleePose, // lane KNIFE / FEEL: windup / ready / slash / recovery pose (weapons/meleeView.ts)
      actionOpen: this.weapon.actionOpen, // (weapon variety, lane GUNS) a break action's barrels open / closed
      // (task studio-turnstile-reload-visuals-20261112-063646-01) a revolver's chambers show the held stack's own live rounds / fired hulls
      live: wdef && !wdef.melee && this.weapon.stack ? this.weapon.stack.mag ?? 0 : undefined, spent: this.weapon.stack?.spent ?? 0,
      shellDue: this.weapon.shellDue !== null && wdef && reserveFor(wdef, this.inv) > 0 ? this.weapon.shellDue : null, // + the shell going in (only with one in the reserve)
      down: this.vmDown.set(0, -1, 0).applyQuaternion(this.camera.getWorldQuaternion(this.vmQuat).invert()),
    });
    // (task turnstile-reload-visuals) thrown hulls that left the held view land in the world's bounded casing pool
    this.viewmodel.flushHulls(this.camera, this.hullSink);
    prof.lap(SPAN.hud);
    this.hud.setStance(p.crouched, p.standBlocked);
    this.updateHud(wdef);
    // Iteration 04 (Lane E): while sighted through the rifle optic its lens draws the reticle, so the HUD crosshair hides.
    const crosshair = document.getElementById('crosshair');
    const opticHide = this.viewmodel.opticAim > 0.6;
    if (crosshair && (crosshair.style.visibility === 'hidden') !== opticHide) crosshair.style.visibility = opticHide ? 'hidden' : '';

    prof.lap(SPAN.rules);
    if (!p.alive) this.die();
    // Iteration 16 (RUN): a SECTION is cleared once per run (remembered); the clear screen shows when its whole LEVEL is clear
    // (the subway: its one station; the office: the street station and every floor), else a toast points onward.
    const remaining = this.aliveEnemies();
    if (remaining === 0 && this.wonAt < 0 && !this.sectionCleared && this.layout.zombies.length > 0 && this.state === 'playing') {
      this.wonAt = this.time;
      this.sectionCleared = true;
      this.run.memory().cleared = true;
      this.sfx.win();
      this.hud.toast(clearLabel(this.run.current));
    }
    // (campaign foundation) a cleared station is only remembered + toasted: no clear modal, nothing is gated on kills
    if (this.wonAt >= 0 && this.time - this.wonAt > 1.6 && this.wonAt > -1 && !this.wonShown) this.wonShown = true;
  }
  private wonShown = false;
  // Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY, user: "especially stuttering"): update()'s per-frame scratch —
  // the eye and look vectors (their callees read them during the call, none keeps them: containers.target copies the eye) and the
  // unreachable eye of a ride / a container target — instead of 2-3 new vectors a frame (garbage for the periodic collections).
  private readonly frameEye = new THREE.Vector3();
  private readonly frameLook = new THREE.Vector3();
  private readonly farEye = new THREE.Vector3(0, 1e6, 0);
  /** (task turnstile-reload-visuals) the world's down in camera space for the held view's thrown hulls. */
  private readonly vmDown = new THREE.Vector3();
  private readonly vmQuat = new THREE.Quaternion();
  /** (task turnstile-reload-visuals) a thrown hull into the world's casing pool (one closure, not one per frame). */
  private readonly hullSink = (pos: THREE.Vector3, dir: THREE.Vector3, speed: number): void => this.physics.ejectAt(pos, dir, 'shell', this.camera, this.player, speed);

  /** Lane PLAY: enemies still alive (update's clear rule and the HUD count; was a filtered array, twice a frame). */
  private aliveEnemies(): number {
    let n = 0;
    for (const z of this.zombies) if (z.brain.alive) n++;
    return n;
  }

  /**
   * Task studio-alpha-campaign-foundation-20261102-230708-01: THE campaign win (the Reactor's ending; world/reactor/restart.ts calls
   * it once). Recorded in the run (saved at the next autosave); exploration goes on — nothing is reset, no modal blocks play.
   */
  onCampaignWin(via: string): void {
    const c = this.run.campaign;
    if (!c || c.won) return;
    // the user's win is the habitable SURFACE: where the Reactor has its surface ending (reactor-surface-ending: layout.reactor.surface,
    // reactor.state.ending.surfaced), the rods only bring the reactor ONLINE — the win waits for the surface (campaignTick)
    if (via === 'reactor-restarted' && (this.layout as {reactor?: {surface?: unknown}}).reactor?.surface) return;
    c.won = {at: new Date().toISOString(), station: c.current, via};
    this.hud.toast('RUN COMPLETE — the reactor is running. Keep exploring, or head back to the train.');
    for (const l of this.campaignListeners) l('won');
  }
  /** (campaign) listeners for campaign events ('won' | 'autosave' | 'transit'): the menu / HUD / save lanes subscribe. */
  readonly campaignListeners: ((event: string) => void)[] = [];

  private updateCamera(dt: number): void {
    const p = this.player;
    const bob = Math.sin(p.bobT * 2) * 0.025 * Math.min(1, p.speed / WALK_SPEED);
    this.camera.position.set(p.x, p.eye + bob, p.z);
    const sh = this.shake * this.shake;
    const t = this.time;
    // Iteration 16: `aimOffset` (lane INJURY: arm-injury sway) moves the real aim — shots, crosshair and the optic dot follow it
    this.camera.rotation.set(p.pitch + this.recoilPitch + this.aimOffset.pitch + Math.sin(t * 37) * 0.02 * sh, p.yaw + this.recoilYaw + this.aimOffset.yaw + Math.sin(t * 29) * 0.02 * sh, Math.sin(t * 23) * 0.015 * sh);
    this.trainRide?.tiltCamera(this.camera); // (lane RIDE) the moving car's roll / pitch (its jostle) on the view; no-op when not riding
    this.skywaysCar?.tiltCamera(this.camera); // (Skyways prize display) its body pitch on a flight; no-op out of it / on flat floor
    const targetFov = this.aiming ? (WEAPONS[this.weapon.def?.id ?? 'rifle']?.aimFov ?? 60) : this.settings.fov;
    const fov = this.camera.fov + (targetFov - this.camera.fov) * Math.min(1, dt * 14 || 1);
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld(true);
  }

  private updateHud(wdef: WeaponDef | null): void {
    const p = this.player;
    const st = this.inv.selectedStack();
    const def = st ? itemDef(st.itemId) : null;
    let hint = '';
    if (wdef && st) {
      if (wdef.melee) hint = meleeHint(wdef, this.weapon.winding, this.weapon.chargeLevel) ?? (this.weapon.winding ? 'Release to slash' : 'Hold · release to slash'); // lane KNIFE / FEEL (short: a long hint overlapped the hotbar at 960 px); lane MELEE: a weapon-variety line / the slugger's charge cue
      else if (this.weapon.reloading) hint = 'Reloading…';
      else if ((st.mag ?? 0) === 0) hint = reserveFor(wdef, this.inv) ? 'Empty — press R' : `No ${caliberLabel(wdef)} ammo`;
      else if ((st.mag ?? 0) <= wdef.magazine * 0.25 && reserveFor(wdef, this.inv)) hint = 'Low — R to reload';
    } else if (def?.kind === 'consumable') hint = def.treats?.length ? this.injuries.treatmentHint(def) : useHint(def); // Iteration 16 (lane INJURY)
    else if (def?.kind === 'throwable') hint = throwHint(def); // Iteration 12 (LIGHT)
    if (this.gear?.readied) hint = '6 slings it back on · 1-5 / ~ switch'; // Task office-overhaul-20261030 (INTERACT, #1); SLOT: ~ too
    let prompt = '';
    for (const f of this.promptProviders) { const lp = f(); if (lp) { prompt = lp; break; } } // Iteration 16: lane prompts (grounded bag, elevator, …)
    const lanePrompt = !!prompt;
    if (lanePrompt) { /* the lane's interactHandler takes E */ } else if (this.currentTarget) {
      const d = itemDef(this.currentTarget.stack.itemId);
      const n = this.currentTarget.stack.count;
      prompt = `<b>[E]</b> Take ${d.kind === 'weapon' ? d.name : ammoText(d.id, n) ?? `${n > 1 ? n + ' × ' : ''}${d.name}`}`; // lane AMMO: "15 9mm rounds" like holder lots
    } else if (this.containerTarget && this.containers) prompt = this.containers.prompt(this.containerTarget);
    else if (this.ladderAim) prompt = this.ladderAim.up ? '<b>[E]</b> Climb ladder' : '<b>[E]</b> Climb down ladder';
    else if (p.climbing) prompt = '<b>[Space]</b> Let go';
    const spread = wdef ? this.currentSpread(wdef) : 0.02;
    const spreadPx = Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (window.innerHeight / 2);
    const multi = this.levels.count > 1; // Lane B: the area / track bed of the player's own storey
    const area = multi ? this.levels.areaAt(p.x, p.z, p.y) : this.layout.grid.areaAt(p.x, p.z);
    // Iteration 17: the office tower's storey ("Open-plan office · Floor 5 · Bramley House"); task mall-playtest-revision-20261031
    // (lane GEN): the mall's retail floor too ("Paper Lantern Books · Sales floor · Level 2 · Harbourline Center")
    const storey = (this.layout.office || this.layout.mall || this.layout.skyways || this.layout.bunker) && area >= 0 ? storeyLabel(this.layout, this.layout.areas[area].level ?? 0) : '';
    // (+ Skyways: 'Concourse' / 'Street level' / '+15 Skyway' as printed; + the Bunker's storey labels as printed: task studio-bunker-level-20261109-072224-01)
    const storeyName = !storey ? '' : this.layout.mall ? (storey === 'Subway' ? '' : storey) : this.layout.skyways || this.layout.bunker ? storey : storey === 'L' ? 'Lobby' : `Floor ${storey}`;
    const storeyText = storeyName && !(area >= 0 && (this.layout.skyways ? skywalkText(this.layout.areas[area].label) : this.layout.areas[area].label).includes(storeyName)) ? ` · ${storeyName}` : ''; // (a stairwell label already names its floor)
    this.hud.update({
      hp: p.hp, maxHp: p.maxHp, stamina: p.stamina,
      // lane AMMO: a gun shows the caliber it loads ("Pistol · 9mm"); the reserve counts that caliber's pool.
      // INTERACT (#1): slot 6 (the readied backpack) in the hands overrides the weapon panel.
      weaponName: this.gear?.readied ? 'Backpack · click sets it down' : def ? (wdef?.caliber ? `${def.short} · ${caliberLabel(wdef)}` : def.short) : 'Empty hands',
      mag: wdef && st && !wdef.melee && !this.gear?.readied ? st.mag ?? 0 : null, reserve: wdef ? reserveFor(wdef, this.inv) : 0,
      melee: !!wdef?.melee && !this.gear?.readied, // lane KNIFE: MELEE tag, no rounds
      hint, prompt, promptItem: lanePrompt ? undefined : this.currentTarget?.stack.itemId,
      remaining: this.aliveEnemies(), total: this.layout.zombies.length, // Iteration 16: kills earlier in the run stay dead (not spawned)
      objLine: '', // (campaign foundation) the scavenge objective has no kill counter
      area: area >= 0 ? `${this.layout.skyways ? skywalkText(this.layout.areas[area].label) : this.layout.areas[area].label}${storeyText} · ${this.layout.name}` : (multi ? this.levels.cellKindAt(p.x, p.z, p.y) : this.layout.grid.get(...this.layout.grid.cellOf(p.x, p.z))) === 2 ? `Track bed · ${this.layout.name}` : this.layout.name, // (Skyways: no '+15' wording, task studio-skywalk-variety-20261107-231448-01)
      spreadPx, aiming: this.aiming, flashlight: this.flashlightOn,
      use: this.use ? {label: useLabel(itemDef(this.use.itemId)), progress: this.use.t / this.use.total} : null,
      food: this.survival.hunger, water: this.survival.thirst,
      // Iteration 12 (LIGHT): battery meter + flare (grenade slot) count
      battery: {charge: this.torch.battery.charge, on: this.flashlightOn, flicker: this.torch.battery.flicker, spares: this.inv.count('battery')},
      flares: {count: this.inv.count('flare'), burning: this.flares.burningCount},
      armor: armorPool(this.inv.gear), // task studio-general-armor-20261107-231448-01: the blue armour pips
      armorTemp: this.beerEffects?.tempArmor() ?? 0, // (task studio-market-bar-20261108-225231-01, lane BEER) Ironclad Stout: shown on top, distinguishable
      beer: this.beerEffects?.active ?? null, // (lane BEER) the active timed beer: name + time left
    }, this.inv);
  }

  // ---------------------------------------------------------------------------------------
  private fire(def: WeaponDef): void {
    // task hitch-attribution-recorder-20261105: fire.fx / fire.rays / hit.world / hit.ragdoll spans (timing only; the profiler's
    // calls are one boolean check when it is not recording — every outcome, RNG draw and allocation is unchanged)
    const prof = this.prof;
    this.stats.shots++;
    this.damage.beginShot();
    this.shotCounter++;
    prof.begin(SPAN.fireFx);
    this.sfx.shot(def.sound, def.shotCycle, def.id); // (lane GUNS: no pump rack after a semi-auto / break-action shotgun's shot; the held gun's own shot by id)
    this.viewmodel.fire(def, stanceRecoilMult(this.player.crouched));
    this.muzzleT = 0.05;
    const f0 = this.forward();
    this.muzzleLight.position.copy(this.camera.position).addScaledVector(f0, 0.8);
    const spread = this.currentSpread(def);
    const kickMul = (this.aiming ? 0.6 : 1) * stanceRecoilMult(this.player.crouched);
    // (weapon variety, lane GUNS: weapons/gunHandling.ts — a def's RecoilClimb / Bloom; the baseline guns' former expressions verbatim)
    const kick = shotRecoil(def, kickMul, this.weapon.streak, this.rand);
    this.recoilPitch += kick.pitch;
    this.recoilYaw += kick.yaw;
    this.player.pitch = Math.min(1.45, this.player.pitch + kick.view);
    this.bloom = shotBloom(def, this.bloom);

    this.camera.updateMatrixWorld(true);
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = this.forward();
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const o: Vec3 = {x: origin.x, y: origin.y, z: origin.z};
    const dmg = new Map<EnemyActor, {total: number; pellets: number; head: boolean; point: THREE.Vector3}>();
    const muzzle = this.viewmodel.muzzleWorld(this.camera);
    this.fx.muzzle(muzzle, fwd, def.pellets > 1);
    this.physics.onFire(def.id, this.viewmodel, this.camera, this.player); // brass now; shotgun hull on the pump
    prof.end(SPAN.fireFx);
    for (let i = 0; i < def.pellets; i++) {
      const a = this.rand() * Math.PI * 2, r = spread * Math.sqrt(this.rand());
      const dir = fwd.clone().addScaledVector(right, Math.tan(r) * Math.cos(a)).addScaledVector(up, Math.tan(r) * Math.sin(a)).normalize();
      const d: Vec3 = {x: dir.x, y: dir.y, z: dir.z};
      prof.begin(SPAN.fireRays);
      // Lane B (iteration 08): through every level's bands — a slab between shooter and target stops the bullet
      // (lane MERCH: struck open shelving -> the first resting shelf piece on the line inside it: physics/merchOnHost.ts)
      const wh = raycastShot(this.levels, this.layout.props, o, d, def.range, this.layout.trench.floorY);
      let bestT = wh.t, bestZ: EnemyActor | null = null, bestPart = 'torso';
      // Lane COMBAT (reactor-playtest-round2): every live enemy's volumes along the full 3D ray, any storey, culled or not (combat/
      // enemyRay.ts: the old cheap reject mis-projected pitched rays and skipped enemies up / down stairs, atria and the pit)
      const eh = nearestEnemyHit(o, d, bestT, this.zombies);
      if (eh) { bestT = eh.t; bestZ = eh.enemy; bestPart = eh.part; }
      // task studio-market-rework-20261108-074144-01 (lane COMBAT): a market person nearer still (its own bone volumes, any storey)
      const mh = this.marketCombat.rayHit(o, d, bestT);
      let bestP: MarketCombatant | null = null;
      if (mh) { bestT = mh.t; bestZ = null; bestP = mh.person; bestPart = mh.part; }
      // Lane D: corpses stop (and tear under) bullets too; shots passing close knock loose pickups about.
      const corpse0 = this.damage.corpseHit(this.zombies, o, d, bestT);
      const corpse = this.damage.corpseHit(this.corpses?.hitTargets() ?? [], o, d, corpse0?.t ?? bestT) ?? corpse0; // (lane CORPSE: + the handled bodies lying there)
      if (corpse) { bestT = corpse.t; bestZ = null; bestP = null; }
      // Iteration 08 (Lane S): a filler stock piece on the pellet line (exact per-piece test; inside a stocked shelf when its box is the
      // world hit) takes the pellet: its impulse at the hit point. Loot items / pickups in front of it still take it first (Lane K path).
      const fh = this.stock.pelletHit(o, d, bestT, wh, this.layout.props, !!bestZ || !!corpse || !!bestP);
      prof.end(SPAN.fireRays);
      if (fh) { bestT = fh.t; bestZ = null; bestP = null; }
      const end = origin.clone().addScaledVector(dir, bestT);
      const shot = {damage: def.damage * WeaponController.falloff(def, bestT), pellet: def.pellets > 1, weapon: def.id};
      // Iteration 07 (Lane K): items / lots / light props on the shot line take the bullet's impulse (it passes on through them)
      if (!fh) this.damage.knockPickups(o, d, bestT, wh, shot);
      else {
        if (!this.damage.knockPickups(o, d, fh.t, undefined, shot)) this.stock.shoot(fh, dir, shot.damage);
        if (fh.glass) { const wp = origin.clone().addScaledVector(dir, wh.t); prof.begin(SPAN.hitWorld); if (!this.bulletHit(wh, wp, dir, shot.damage)) this.damage.hitWorld(wh, wp, dir, shot); prof.end(SPAN.hitWorld); } // through a cooler's glass
      }
      if (bestZ) {
        const mult = bestPart === 'head' ? def.headMult : bestPart === 'limb' ? def.limbMult : 1;
        const amount = def.damage * WeaponController.falloff(def, bestT) * mult;
        const e = dmg.get(bestZ) ?? {total: 0, pellets: 0, head: false, point: end};
        e.total += amount;
        e.pellets++;
        e.head ||= bestPart === 'head';
        dmg.set(bestZ, e);
        // Lane D: rest-space flesh / clothing wound + blood + flesh pieces (was fx.bodyHit only)
        this.damage.hitZombie(bestZ, end, dir, bestPart as 'head' | 'torso' | 'limb', {...shot, damage: amount});
      } else if (bestP) {
        // (lane COMBAT) the same damage (falloff x the weapon's part multiplier), aggregated per person for this trigger pull
        this.marketCombat.pellet(bestP, playerPelletDamage(def, bestPart as 'head' | 'torso' | 'limb', bestT), end, dir, bestPart === 'head', def.id);
      } else if (corpse && !fh) {
        this.damage.hitZombie(corpse.z, end, dir, corpse.part, shot, true);
        this.sfx.impact(end.x, end.y, end.z, 'flesh');
      } else if (!fh && wh.kind !== 'none') {
        // Lane D: material-matched persistent damage (craters / per-instance prop damage / breaking) + fx + sound
        // (task gasmask-breach-20261030: unless a lane handler takes the hit — an office window pane)
        prof.begin(SPAN.hitWorld);
        if (!this.bulletHit(wh, end, dir, shot.damage)) this.damage.hitWorld(wh, end, dir, shot);
        prof.end(SPAN.hitWorld);
      }
      if (def.pellets === 1 ? this.shotCounter % 3 === 0 : i < 3) this.fx.tracer(muzzle, end);
    }
    let anyKill = false;
    for (const [z, e] of dmg) {
      const killed = z.brain.damage(e.total, this.player.x, this.player.z, this.player.y);
      z.hitFlash = 1;
      this.sfx.hitConfirm(e.point.x, e.point.y, e.point.z, z, e.head && !z.nonGraphic); // Iteration 12 (AUDIO): foreground (non-spatial) flesh confirm, once per enemy per shot (pellets aggregated in dmg; `z` de-dups); + the skull crack when a pellet / bullet of this shot really hit its HEAD (task studio-general-armor-20261107-231448-01) — never on a non-graphic body (BB: task studio-bb-production-20261112-234540-01; its head hit still counts below)
      if (e.head) this.stats.headshots++;
      // knockback along the shot direction (stays out of walls)
      const k = def.knockback * (e.pellets / def.pellets) * (killed ? 1.4 : 1);
      if (!z.brain.climbing) [z.brain.x, z.brain.z] = moveCircle(this.levels, this.propIndex, z.brain.x, z.brain.z, fwd.x * k, fwd.z * k, z.brain.stats.radius, z.brain.y, z.brain.stats.height ?? BODY_CLEAR);
      if (!killed) enemyCues(z).hurt(this.sfx, z); // Lane Q: rat/dog yelp (zombies: none)
      if (killed) {
        anyKill = true;
        this.stats.kills++;
        enemyCues(z).death(this.sfx, z); // zombie death cue / rat/dog death (Lane Q adapter)
        // articulated ragdoll from the current pose, shoved by this shot (falls back to the Death clip)
        prof.begin(SPAN.ragdoll);
        this.physics.ragdoll(z, {dir: fwd, point: e.point, strength: killImpulseStrength(def.id, e.pellets, def.pellets), bone: e.head ? 'head' : undefined});
        prof.end(SPAN.ragdoll);
      }
    }
    // (lane COMBAT) each market person this shot reached takes it once: its hit confirm, flinch, the settlement's hostility, a ragdoll
    const people = this.marketCombat.endShot(def);
    if (dmg.size || people.hit) {
      this.stats.hits++;
      this.hud.hitmarker(anyKill || people.kill);
      this.sfx.hitTick(anyKill || people.kill);
    }
    // gunfire alerts zombies; walls muffle it (Lane B, iteration 08: a slab between storeys muffles it more). Task
    // office-seamless-20261029 (ENGINE): 3D distance, x0.35 per slab between the storeys (ai/brain.ts hearingMuffle); no
    // sight test for a zombie already beyond earshot (9 storeys of zombies per shot).
    this.alertZombies(def.noise);
  }

  /**
   * Task gasmask-breach-20261030: offer a bullet's world hit to the lane handlers (this trigger pull's id + the ray's damage after
   * falloff, task gas-mask-roof-feedback-20261030); true = handled.
   */
  private bulletHit(wh: WorldHit, point: THREE.Vector3, dir: THREE.Vector3, damage: number): boolean {
    for (const h of this.bulletHitHandlers) if (h(wh, point, dir, this.shotCounter, damage)) return true;
    return false;
  }

  /** A noise of loudness radius `radius` (m) at the player: zombies in earshot hear it (walls / slabs muffle; see fire()). */
  private alertZombies(radius: number): void {
    this.prof.begin(SPAN.alert); // (task hitch-attribution-recorder-20261105: hit.alert span, timing only)
    const multi = this.levels.count > 1, P = this.player, bases = multi ? this.levels.list.map(l => l.baseY) : null;
    // lane ENEMY (mall round 3, R2): the listener loop is ai/brain.ts alertListeners (moved verbatim; the Node aggro scenario runs it).
    // An open-atrium level (layout.mall) adds the cross-storey rule (ATRIUM_PERCEPTION: x0.7 per storey through the void, at most 3
    // new cross-storey responders per noise); the Subway / Office pass no flag: the established loop.
    alertListeners(this.zombies.map(z => z.brain), P, radius,
      b => multi ? this.levels.lineOfSight({x: P.x, y: P.eye, z: P.z}, {x: b.x, y: b.y + 1.5, z: b.z}) : this.layout.grid.lineOfSight(P.x, P.z, b.x, b.z), bases, !!this.layout.mall || !!this.layout.reactor, // task reactor-build-20261101 (lane ARCH): + the Reactor's open pit (cross-storey hearing)
      this.beerEffects?.perceptionMult() ?? 1); // (task studio-market-bar-20261108-225231-01, lane BEER) the player's one detectability factor (Night Shift Porter)
    this.prof.end(SPAN.alert);
  }

  /**
   * Lane KNIFE (knife-melee-20261030): the blade's contact moment of ONE swing (WeaponController 'contact', `melee.windup` s
   * after the click; a swing cancelled before it never gets here). The sweep (combat/melee.ts) uses the bullet pipeline's
   * pieces: Levels.raycast occlusion (walls / props / slabs of any storey), the enemies' head / torso / limb volumes, corpses
   * as blockers — so a miss stays a miss and at most one enemy takes ONE hit. No bullet, ammo, muzzle flash, recoil, tracer
   * or knockback; the hit never staggers (contact stays a trade). Feedback as a shot hit: wound / blood / flesh pieces
   * (damage/system.ts), the foreground flesh confirm, hit marker + tick, the enemy's hurt / death cue, ragdoll on a kill. A
   * blade hit (flesh or surface) is a quiet noise (`def.noise`, 5 m vs 24-38 m for gunshots); a clean miss is silent.
   * Task studio-weapon-variety-production-20261109-224355-01 (lane MELEE): the six new melee weapons resolve the same contact through
   * the per-swing HIT SET (combat/melee.ts resolveMeleeSweep: up to `melee.maxTargets` DISTINCT targets, each struck once, the same
   * rays / occlusion) — enemies, creatures and Market people alike, through the common head / limb multipliers — and add what the
   * knife never had (combat/meleeImpact.ts): the stamina cost paid here (short = a winded swing), a charge weapon's charge
   * (WeaponController.swingCharge), a sweep's reduced 2nd target, a mass-scaled push (protected bosses barely move; delivered by
   * meleeShoves, never through walls / off the floor), a stagger under the brain's own cooldown rules, a heavier kill impulse, and the
   * normal prop hit interactions (meleeProps). The knife has none of those MeleeSpec fields: its path below is the one it always had.
   */
  private meleeContact(def: WeaponDef): void {
    if (!def.melee || !this.player.alive || this.state !== 'playing') return;
    this.camera.updateMatrixWorld(true);
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = this.forward();
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const o: Vec3 = {x: origin.x, y: origin.y, z: origin.z};
    const L = this.levels, props = this.layout.props, trench = this.layout.trench.floorY;
    const m = def.melee, dirs = meleeRayDirs(fwd, right, up, m.rays);
    // (task studio-market-rework-20261108-074144-01, lane COMBAT: + the market's people, their own volumes)
    const targets = [...this.zombies.map(z => ({id: z as EnemyActor | MarketCombatant, alive: z.brain.alive, x: z.brain.x, y: z.brain.y, z: z.brain.z, volumes: z.hitVolumes})), ...this.marketCombat.meleeTargets()];
    const world = (ro: Vec3, rd: Vec3, max: number) => raycastWorld(L, props, ro, rd, max, trench);
    const corpses = (ro: Vec3, rd: Vec3, maxT: number) => { const c = this.damage.corpseHit(this.zombies, ro, rd, maxT); return this.damage.corpseHit(this.corpses?.hitTargets() ?? [], ro, rd, c?.t ?? maxT) ?? c; }; // (lane CORPSE: + the handled bodies lying there)
    // lane MELEE: a weapon-variety sweep's hit set; the knife: resolveMelee's one target, as ever
    const sweep = m.maxTargets ? resolveMeleeSweep(o, dirs, def.range, targets, world, corpses, m.maxTargets) : asMeleeSweep(resolveMelee(o, dirs, def.range, targets, world, corpses));
    // lane MELEE: the swing's stamina is paid at its contact (a cancelled swing costs nothing; the knife costs 0), then its scaling
    const charge = this.weapon.swingCharge;
    const swing = meleeSwing(m, charge, !this.player.spendStamina(meleeStaminaCost(m, charge)));
    const res0 = sweep.contact;
    if (!sweep.hits.length && !res0) { if (m.propHits) this.meleeProps(def, o, dirs[0], def.range, null, swing.damageMult); this.logMelee({kind: 'miss'}); return; } // a clean miss: only the swing's rustle (lane MELEE: loose items on the line still take it)
    this.damage.beginShot(); // one wound / tear group per swing
    const wound = {damage: 24, pellet: false, weapon: def.id}; // wound / gore sizing of one rifle round
    let anyKill = false;
    // lane MELEE: each struck target ONCE (the per-swing hit set: the knife's is its one target)
    for (const [i, res] of sweep.hits.entries()) {
      const point = new THREE.Vector3(res.point.x, res.point.y, res.point.z), dir = new THREE.Vector3(res.dir.x, res.dir.y, res.dir.z);
      const amount = meleeHitDamage(def, res.part, swing, i);
      if (this.marketCombat.isCombatant(res.target)) {
        // (lane COMBAT) a market person: the blade's damage once (its confirm / flinch / hostility / ragdoll inside)
        const killed = this.marketCombat.meleeHit(res.target, amount, res.part, point, dir, def.id);
        anyKill ||= killed;
        this.logMelee({kind: 'person', part: res.part, t: +res.t.toFixed(3), damage: amount, killed, id: res.target.id});
        continue;
      }
      const z = res.target as EnemyActor, arch = archetypeOf(z);
      const knock = meleeKnockFor(swing.knockback, arch, z.brain.type); // lane MELEE: by the target's mass (protected bosses resist)
      this.damage.hitZombie(z, point, dir, res.part, wound);
      const killed = z.brain.damage(amount, this.player.x, this.player.z, this.player.y, swing.stagger > 0 ? meleeStaggerOpts(swing.stagger, arch) : {stagger: false});
      z.hitFlash = 1;
      this.sfx.hitConfirm(point.x, point.y, point.z, z, res.part === 'head' && !z.nonGraphic); // (+ the head crack on a confirmed head hit: task studio-general-armor-20261107-231448-01; never on a non-graphic body — BB: task studio-bb-production-20261112-234540-01)
      if (killed) {
        anyKill = true;
        this.stats.kills++;
        enemyCues(z).death(this.sfx, z);
        this.prof.begin(SPAN.ragdoll);
        this.physics.ragdoll(z, {dir: fwd, point, strength: meleeKillStrength(killImpulseStrength(def.id, 1, 1), knock), bone: res.part === 'head' ? 'head' : undefined});
        this.prof.end(SPAN.ragdoll);
      } else {
        enemyCues(z).hurt(this.sfx, z);
        if (knock > 0) { const [px, pz] = meleePushDir(res.dir, right, m.knockSide); this.meleeShoves.add(z.brain, px, pz, knock); } // lane MELEE: the push
      }
      this.logMelee({kind: 'enemy', part: res.part, t: +res.t.toFixed(3), damage: amount, killed, hp: z.brain.hp, archetype: z.archetype ?? 'zombie', type: z.brain.type, ...(knock > 0 ? {knock: +knock.toFixed(3)} : {})});
    }
    if (sweep.hits.length) {
      this.hud.hitmarker(anyKill);
      this.sfx.hitTick(anyKill);
    } else if (res0?.kind === 'corpse') {
      const point = new THREE.Vector3(res0.point.x, res0.point.y, res0.point.z), dir = new THREE.Vector3(res0.dir.x, res0.dir.y, res0.dir.z);
      this.logMelee({kind: 'corpse', t: +res0.t.toFixed(3)});
      this.damage.hitZombie(res0.corpse.z, point, dir, res0.corpse.part, wound, true);
      this.sfx.impact(point.x, point.y, point.z, 'flesh');
    } else if (res0) {
      const point = new THREE.Vector3(res0.point.x, res0.point.y, res0.point.z), wh = res0.hit;
      // lane MELEE: a weapon-variety weapon's normal prop hit (a struck prop / loose items); the knife (and a bare surface): chips only
      if (!(m.propHits && this.meleeProps(def, o, res0.dir, res0.t, wh, swing.damageMult))) {
        // blade on a surface: its material's impact cue and a few chips, no crater / prop damage (a knife does not break things)
        const n = new THREE.Vector3(wh.nx, wh.ny, wh.nz);
        const spec = wh.kind === 'prop' && wh.prop !== undefined && props[wh.prop] ? DAMAGE_MATERIALS[propDamageSpec(props[wh.prop].kind).cls]
          : wh.kind === 'wall' || wh.kind === 'floor' || wh.kind === 'ceiling' ? DAMAGE_MATERIALS[this.damage.structuralClassAt(wh.kind, wh.level, point, n)] : DAMAGE_MATERIALS.concrete; // (task reactor-expansion-20261101, lane CONTROLS: the surface's own material)
        this.sfx.impact(point.x, point.y, point.z, spec.sound);
        this.fx.impact(point, n, spec.fx, {decal: false, chips: 2, dust: 0.35});
      }
      this.logMelee({kind: 'world', surface: wh.kind, t: +res0.t.toFixed(3)});
    }
    this.alertZombies(def.noise);
  }

  /**
   * Task studio-weapon-variety-production-20261109-224355-01 (lane MELEE): a weapon-variety swing's NORMAL prop hit interactions along
   * the contact ray `d` up to `t` (the struck surface, or the reach on a miss) — the bullet pipeline's pieces, never its window /
   * lane handlers: loose pickups / lots / light movable props on the line take the impulse (DamageSystem.knockPickups), shelf stock
   * the blow (ShelfStock.pelletHit / shoot), and a struck prop its normal hit (DamageSystem.hitWorld: per-instance damage, a movable
   * prop's shove, its cue / fx). Returns true when something there took the hit (else the caller shows the knife's chips).
   */
  private meleeProps(def: WeaponDef, o: Vec3, d: Vec3, t: number, wh: WorldHit | null, damageMult: number): boolean {
    const shot = {damage: def.damage * damageMult, pellet: false, weapon: def.id}, dir = new THREE.Vector3(d.x, d.y, d.z);
    const props = this.layout.props;
    const fh = wh ? this.stock.pelletHit(o, d, t, wh, props, false) : null;
    if (fh) {
      if (!this.damage.knockPickups(o, d, fh.t, undefined, shot)) this.stock.shoot(fh, dir, shot.damage);
      return true;
    }
    if (this.damage.knockPickups(o, d, t, wh ?? undefined, shot) > 0) return true;
    if (wh?.kind === 'prop' && wh.prop !== undefined && props[wh.prop]) {
      this.damage.hitWorld(wh, new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t), dir, shot);
      return true;
    }
    return false;
  }

  /**
   * Task studio-weapon-variety-production-20261109-224355-01 (lane MELEE): heavy melee pushes under way (combat/meleeImpact.ts: bounded,
   * 0.2 s each, one per body); stepped once a frame in play (stepMeleeShoves), cleared whenever play stops.
   */
  readonly meleeShoves = new MeleeShoves<EnemyActor['brain']>();
  private stepMeleeShoves(dt: number): void {
    this.meleeShoves.update(dt, (b, dx, dz) => meleeShoveStep(b, dx, dz,
      (x, z, mx, mz) => moveCircle(this.levels, this.propIndex, x, z, mx, mz, b.stats.radius, b.y, b.stats.height ?? BODY_CLEAR),
      (x, z, y) => this.levels.supportIn(x, z, y + 0.05, 0.3)?.floor));
  }

  /** Lane KNIFE (QA, `__LL.snapshot().melee`): the last few swing contacts and what they struck (read-only record). */
  readonly meleeLog: {swing: number; time: number; kind: string; [k: string]: unknown}[] = [];
  private logMelee(e: {kind: string; [k: string]: unknown}): void {
    this.meleeLog.push({swing: this.weapon.swingId, time: +this.time.toFixed(3), ...e});
    if (this.meleeLog.length > 8) this.meleeLog.shift();
  }

  /** Task studio-screacher-production-20261110-221858-01: this section's living-or-dead Screacher brains (the only listeners of worldNoise). */
  private readonly screacherBrains: ScreacherBrain[] = [];
  /** Last worldNoise delivery per kind (s of game time): one crash's many contacts are a few events, not one per contact. */
  private readonly noiseAt: Partial<Record<ScreacherNoiseKind, number>> = {};
  /** QA / tests: world sounds raised and how many Screacher ears they reached. */
  readonly noiseCounts = {raised: 0, heard: 0, echoScans: 0, echoHits: 0};

  /**
   * Task studio-screacher-production-20261110-221858-01: A WORLD SOUND at (x, feet-height y, z) of loudness `radius` (m) — a sprinting
   * footstep, a landing, a prop / item impact, a dragged box. Only Screachers listen (ai/screacher.ts deliverNoise: muffled per
   * listener like gunfire — a wall x0.6, each floor slab x0.35 — from a line between the SOURCE and that listener); every other
   * enemy's hearing is untouched (gunfire through alertZombies, which Screachers also hear). No level without a Screacher pays for it;
   * impact / drag bursts are merged (at most one delivery per kind per 0.08 s).
   */
  worldNoise(x: number, y: number, z: number, radius: number, kind: ScreacherNoiseKind): void {
    if (!(radius > 0) || !this.screacherBrains.length || !this.layout) return;
    if ((kind === 'impact' || kind === 'drag') && this.time - (this.noiseAt[kind] ?? -1) < 0.08) return;
    this.noiseAt[kind] = this.time;
    const L = this.levels, multi = L.count > 1, bases = multi ? L.list.map(l => l.baseY) : null;
    this.noiseCounts.raised++;
    this.noiseCounts.heard += deliverNoise(this.screacherBrains, {x, y, z}, radius, kind,
      b => multi ? L.lineOfSight({x, y: y + 0.6, z}, {x: b.x, y: b.y + 1.5, z: b.z}) : this.layout.grid.lineOfSight(x, z, b.x, b.z), bases);
  }

  /**
   * Task studio-screacher-production-20261110-221858-01: the Screacher's ECHO scan (BrainWorld.echo; asked once per scream, at its cue
   * instant). The player is located only when within `range` (3D, from the stump) AND a straight line from the stump to the player's
   * chest or head is clear of solid geometry (ai/screacher.ts echoLocate) — BOTH the enemies' sight line (walls, floors and ceilings,
   * closed stall doors and elevator gates) AND the bullet line (combat/hitscan.ts raycastWorld: + solid props such as counters,
   * cabinets and the parked train's shell and closed doors): behind a wall, on another storey through a slab, or crouched behind
   * solid cover the scream finds nothing. Returns the position at THIS instant (a snapshot).
   */
  private echoScan(x: number, y: number, z: number, range: number): {x: number; z: number; y: number} | null {
    const p = this.player;
    this.noiseCounts.echoScans++;
    if (!p.alive || this.trainRide.riding || this.skywaysCar.driving) return null;
    const L = this.levels, multi = L.count > 1;
    const hit = echoLocate({x, y, z}, p, range, (from, to) => {
      // sight-blocking structure first (walls, slabs, closed stall doors and elevator gates: the enemies' own sight line) ...
      if (!(multi ? L.lineOfSight(from, to) : this.layout.grid.lineOfSight(from.x, from.z, to.x, to.z))) return false;
      // ... then the bullet line (solid props too: counters, cabinets, the parked train's shell and closed doors)
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, d = Math.hypot(dx, dy, dz);
      const h = raycastWorld(L, this.layout.props, from, {x: dx / d, y: dy / d, z: dz / d}, d, this.layout.trench.floorY);
      return h.kind === 'none' || h.t >= d - 0.05;
    });
    if (hit) this.noiseCounts.echoHits++;
    return hit;
  }

  private brainWorld(): BrainWorld {
    const g = this.layout.grid, L = this.levels, multi = L.count > 1;
    return {
      echo: (x, y, z, range) => this.echoScan(x, y, z, range), // (the Screacher's scream; no other brain calls it)
      // task studio-bb-production-20261112-234540-01: the level's solid geometry for BB's wall / ceiling crawl and leap, and the eye its sight and aim use
      crawl: this.crawlWorld(), pEye: this.player.eye,
      px: this.player.x, pz: this.player.z, playerAlive: this.player.alive,
      // Lane B (iteration 08): stacked levels — 3D sight between eye lines (1.5 m over the feet), so a slab between storeys blocks it.
      los: (ax, az, bx, bz, ay, by) => multi && ay !== undefined && by !== undefined ? L.lineOfSight({x: ax, y: ay + 1.5, z: az}, {x: bx, y: by + 1.5, z: bz}) : g.lineOfSight(ax, az, bx, bz),
      // Lane T (iteration 05): height-aware lines/paths (stairs, platform-edge drops, rescue-ladder links); Lane B: on the right storey.
      walkClear: (ax, az, bx, bz, r, ay, by) => multi && ay !== undefined ? L.walkLineClear(ax, ay, az, bx, bz, r, by) : g.walkLineClearH(ax, az, bx, bz, r),
      // Large station: cross-track detours via the underpasses need ~20k expansions (brain backs off on failure).
      findPath: (ax, az, bx, bz, opts) => {
        this.prof.begin(SPAN.path); // lane MEASURE: every path search (A* + string pulling) of this frame
        // lane SCHED: through the path service (immediate unless a far, not-in-sight chase re-plan: then possibly queued = undefined)
        // Task track3-eaton-centre-20261031 (lane HORDE, atrium AI): in an open-atrium level a chase may join a recent route of another
        // chaser to the same goal (still answered at once; ai/chaseShare.ts). Other levels (no share): exactly the line below.
        const C = this.chaseShare, shared = C ? C.lookup(ax, az, bx, bz, opts) : undefined;
        const path = shared !== undefined ? shared : this.pathService ? this.pathService.request(ax, az, bx, bz, opts) : this.pathfinder.find(ax, az, bx, bz, 0.34, searchExpand(opts), opts);
        if (C && shared === undefined) C.remember(ax, az, bx, bz, opts, path);
        this.prof.end(SPAN.path);
        return path;
      },
      py: this.player.y,
      ladder: id => this.layout.traversal.ladders[id],
      randomNear: (x, z, r, y) => {
        // Lane B: wander targets on the zombie's own storey
        const lv = multi && y !== undefined ? L.levelAt(x, z, y + 0.05) : 0;
        const G = lv > 0 ? L.grid(lv) : g;
        for (let i = 0; i < 14; i++) {
          const tx = x + (this.rand() * 2 - 1) * r, tz = z + (this.rand() * 2 - 1) * r;
          const [cx, cy] = G.cellOf(tx, tz);
          if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) {
            const c = G.center(cx, cy);
            return multi ? [c[0], c[1], G.cellFloor(cx, cy)] : c;
          }
        }
        return null;
      },
      rand: this.rand,
      // Iteration 12 (AI): light lure — this frame's attracting lights, 3D eye-to-point sight, standable goal near a lit spot (ai/lightLure.ts).
      ...lureWorld(L, this.lightSources),
      // task studio-refinement-batch-20261113-035659-01 (lane LURE): the lure grenade's active scents (ai/scentLure.ts: SCENT.radius 30 m in 3D, no sight)
      scents: this.scents.list,
      // Task track3-eaton-centre-20261031 (lane HORDE, atrium AI): open-atrium chase rules (ai/brain.ts BrainWorld.atrium); absent elsewhere
      ...(this.layout.mall || this.layout.reactor ? {atrium: true} : {}), // (reactor-build, lane ARCH: + the open pit)
      // Task studio-beta-mall-round3-20261031-01 (lane ENEMY, R2): the open-atrium notice rule (ai/brain.ts ATRIUM_PERCEPTION); mall only
      ...(this.layout.mall || this.layout.reactor ? {atriumNotice: true} : {}), // (reactor-build, lane ARCH: + the open pit)
      // task studio-market-bar-20261108-225231-01 (lane BEER): the player's ONE detectability factor (Night Shift Porter 0.75; else 1)
      detect: this.beerEffects?.perceptionMult() ?? 1,
    };
  }

  /**
   * Task studio-bb-production-20261112-234540-01: BB's CrawlWorld of the current section (ai/bbSurface.ts: the bullet line over the
   * structure and the solid props, the free bands, the standable floors, the 3D sight line) — built once per section's levels / props.
   */
  private crawlWorld(): CrawlWorld {
    const c = this.bbCrawl;
    if (c && c.levels === this.levels && c.props === this.layout.props) return c.world;
    const world = levelsCrawlWorld(this.levels, this.layout.props, this.layout.trench.floorY);
    this.bbCrawl = {levels: this.levels, props: this.layout.props, world};
    return world;
  }
  private bbCrawl: {levels: Levels; props: readonly PropPlacement[]; world: CrawlWorld} | null = null;

  /** Lane B (iteration 08): a sound at (x, y, z) is occluded from the player (3D on stacked levels; 2D walls otherwise). */
  private soundOccluded(x: number, z: number, y?: number): boolean {
    const p = this.player;
    if (this.levels.count > 1 && y !== undefined) return !this.levels.lineOfSight({x: p.x, y: p.eye, z: p.z}, {x, y: y + 0.05, z}, {slack: 0.3});
    return !this.layout.grid.lineOfSight(p.x, p.z, x, z);
  }

  /**
   * Lane SCHED (ai/pathService.ts nearPlayerRule): a path requester at (x, z, feet y) is NEAR the player — its re-plan is never
   * deferred: a few metres away, or a short navigable route by the vocal-reach field (straight line without a field).
   */
  private nearPlayer(x: number, z: number, y: number | undefined): boolean {
    const p = this.player, fy = y ?? p.y, r = this.vocalReach;
    return nearPlayerRule(Math.hypot(x - p.x, z - p.z, fy - p.y), () => r?.ready ? r.pathTo(x, fy + 1.2, z) : null);
  }

  private updateZombies(dt: number): void {
    this.pathService?.tick(); // lane SCHED: frames since each queued far re-plan was last asked for
    const w = this.brainWorld();
    const p = this.player, prof = this.prof; // lane MEASURE: nested spans (off: one boolean check each)
    prof.begin(SPAN.vocal);
    this.vocalReach?.update(dt, p.x, p.y, p.z); // lane AUDIO: refresh the route field (<= 2.5 Hz) before vocals; lane SCHED: its slices run as frameBudget chunks
    prof.end(SPAN.vocal);
    // Task track3-eaton-centre-20261031 (lane HORDE): the groups' patrol intent / formation slots before the members think
    // (phased: far groups every 3rd frame; their leg searches go through the path service like far chase re-plans)
    const H = this.hordes;
    this.chaseShare?.tick(dt); // lane HORDE (atrium AI): the shared routes' clock
    H?.update(dt, w, p);
    for (const z of this.zombies) {
      const b = z.brain;
      const seqBefore = b.attackSeq;
      prof.begin(SPAN.brain);
      const home = this.wanderHomes.get(z); // (lane SPAWNS: a zone-local enemy's random walk targets stay in its zone while it stands there)
      const out = b.update(dt, home ? homeWorld(w, home, this.levels, b) : w);
      prof.end(SPAN.brain);
      if (H && out.alerted) H.alerted(b, p.y); // lane HORDE: group mates within earshot hear the call (brain.hear; never group-wide); lane ENEMY (mall R2): a cross-storey sighting calls at most 2
      prof.begin(SPAN.motor);
      if (out.face !== null) {
        let d = out.face - b.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * dt;
        b.yaw += Math.max(-turn, Math.min(turn, d));
      }
      // Lane T (iteration 05): height-aware motor (stairs, drops into the track bed, ladder climbs by the brain).
      const moved = moveZombie(b, out, dt, this.levels, this.propIndex); // Lane B: stacked levels
      if (b.alive && !b.climbing) {
        // keep bodies apart: other zombies and the player (same level only: platform vs track bed do not shove)
        // (BB comes to the floor wherever a leap or a climb ends, also right at somebody's feet: it is eased out at a bounded pace,
        // so one frame's push can never carry its small body through the wall beside it)
        const ease = b instanceof BbBrain ? bbShoveStep(dt) : Infinity;
        for (const o of this.zombies) {
          if (o === z || !o.brain.alive || !sameLevel(b.y, o.brain.y) || (o.placesRoot && o.brain.climbing)) continue; // (a BB on a wall / ceiling / in the air shoves nobody)
          const dx = b.x - o.brain.x, dz = b.z - o.brain.z, d = Math.hypot(dx, dz), min = b.stats.radius + o.brain.stats.radius;
          if (d > 1e-4 && d < min) { const push = Math.min((min - d) * 0.5, ease); b.x += dx / d * push; b.z += dz / d * push; }
        }
        const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz), min = b.stats.radius + p.radius + 0.22;
        if (d > 1e-4 && d < min && sameLevel(b.y, p.y)) { const push = Math.min(min - d, ease); b.x += dx / d * push; b.z += dz / d * push; }
        settleZombie(b, this.levels, this.propIndex);
      }
      if (b instanceof BbBrain) b.syncFloor(); // (its pose is written inside update(), before the motor: the floor body is shown where the motor left it)
      // positional (panner) enemy audio: vocals, swings, footfalls — per archetype (Lane Q cue adapter;
      // the zombie adapter makes exactly the previous groan / swing / gait / ladder calls)
      prof.end(SPAN.motor);
      prof.begin(SPAN.anim);
      const dist = Math.hypot(b.x - p.x, b.z - p.z); // (lane PLAY: panOf's distance without a tuple per enemy a frame)
      const cues = enemyCues(z);
      if (out.alerted) cues.alert(this.sfx, z);
      if (b.attackSeq !== seqBefore) cues.attack(this.sfx, z);
      H?.vocalGate(b, z, dt, this.rand); // lane HORDE: one idle groan per group at a time (the Sfx's 3-voice vocal cap on top)
      cues.tick(this.sfx, z, dt, moved, dist, this.rand);
      if (out.attackHit) this.hurtPlayer(z);
      // lane HORDE: calm far horde members animate every 3rd frame (the skipped time is applied then); everyone else as before
      const adt = H ? H.animStep(b, dt, dist) : dt;
      if (adt > 0) z.animate(adt, out.anim, moved);
      z.syncTransform();
      if (!z.ragdolled && !z.placesRoot) z.root.position.y = b.y; // Lane T: feet on stairs / track bed / underpass / ladder (BB places its own root: a wall / ceiling body is not at the feet height)
      // Task studio-alpha-strainer-lumbering-wetness-20261101-01: the Strainer's bounded wet-shine trail (ai/strainerTrail.ts, fx WET_TRAIL)
      if (archetypeOf(z) === 'strainer') this.strainerTrail.step(z, b, z.ragdolled, (x, y, wz, size) => this.fx.wet(x, y, wz, size), Math.random); // (visual only: never the game RNG)
      if (adt > 0) z.updateVolumes();
      prof.end(SPAN.anim);
    }
  }

  private hurtPlayer(z: EnemyActor): void {
    const p = this.player;
    // Iteration 16: one hit pipeline — location -> armor (worn gear) -> HP -> listeners (limb injuries)
    // Iteration 16 (lane INJURY): rat / dog bites are 'creature' hits that land low (legs ~58 %, player/injuries.ts biteHitLocation)
    // Task track1-siren-blightbelly-20261031 (lane SIREN): the Siren's claw swipe is a standing humanoid melee hit (melee locations, 'zombie' source), attacker 'siren'
    // Task track1-siren-blightbelly-20261031 (lane BLIGHT): the Blightbelly's fist slam too (an ordinary zombie hit: melee locations, 'zombie' source), attacker 'blightbelly'
    // Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): the Strainer's long claw swipe too (a standing humanoid melee hit), attacker 'strainer'
    // Task studio-screacher-production-20261110-221858-01: the Screacher's long-arm rake too (a standing humanoid melee hit), attacker 'screacher'
    // Task studio-bb-production-20261112-234540-01: BB's pounce too — it leaps at the chest, so the hit lands like a standing melee hit (not a low bite), attacker 'bb'
    const claw = archetypeOf(z) === 'siren' || archetypeOf(z) === 'blightbelly' || archetypeOf(z) === 'strainer' || archetypeOf(z) === 'screacher' || archetypeOf(z) === 'bb';
    const creature = archetypeOf(z) !== 'zombie' && !claw;
    const hit: PlayerHit = {amount: z.brain.stats.attackDamage, source: creature ? 'creature' : 'zombie', enemy: true,
      location: creature ? biteHitLocation(this.rand(), p.crouched) : meleeHitLocation(this.rand(), p.crouched), attacker: creature || claw ? archetypeOf(z) : z.brain.type};
    const resolved = this.applyPlayerHit(hit);
    const amount = resolved.applied;
    const dx = z.brain.x - p.x, dz = z.brain.z - p.z;
    const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    const fwd = -dx * s - dz * c, right = dx * c - dz * s;
    this.hud.damage(Math.atan2(right, fwd), amount);
    this.shake = Math.min(1, this.shake + 0.6);
    // directional camera punch: head snaps up and away from the attacker (recovers with recoil)
    this.recoilPitch += 0.035;
    this.recoilYaw += Math.sign(right) * 0.03;
    this.sfx.hurt();
    if (archetypeOf(z) === 'strainer') this.sfx.strainerContact(z.brain.x, z.brain.z); // lane AUDIO (strainer squish set): the wet claw contact — only for a connecting swipe (out.attackHit), never a miss
    this.cancelUse('hit'); // a zombie hit knocks the item away from the face (nothing consumed)
  }

  /**
   * Task track1-siren-blightbelly-20261031 (lane BLIGHT): a Blightbelly's death blast reaching the player from (fromX, fromZ) — the
   * one hit pipeline (armour / injuries; source 'blast'), the HUD damage direction, a camera shake, the hurt cue; an item being
   * used is knocked away like any hit. The gas mask plays no part (it only filters the gas cloud).
   */
  blastPlayer(hit: PlayerHit, fromX: number, fromZ: number): ResolvedHit {
    const p = this.player, resolved = this.applyPlayerHit(hit);
    const dx = fromX - p.x, dz = fromZ - p.z, s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    this.hud.damage(Math.atan2(dx * c - dz * s, -dx * s - dz * c), resolved.applied);
    this.shake = Math.min(1, this.shake + 0.5 + resolved.applied / 40);
    this.recoilPitch += 0.03;
    this.sfx.hurt();
    this.cancelUse('hit');
    return resolved;
  }

  /**
   * Task studio-market-rework-20261108-074144-01 (lane COMBAT): a hostile survivor's round reaching the player from (fromX, fromZ) — the
   * ENEMY hit (`hit.enemy`) through the one pipeline like a zombie's claw (the enemy x2 once, armour, the injury save, wear), with the
   * same directional feedback as any hit from somewhere (HUD direction, shake, hurt cue, an item in use knocked away).
   */
  gunshotPlayer(hit: PlayerHit, fromX: number, fromZ: number): ResolvedHit {
    return this.blastPlayer(hit, fromX, fromZ);
  }

  /** (lane COMBAT) Someone else's muzzle flash lights the scene (the player's muzzle light, when the player is not firing this instant). */
  npcMuzzleLight(at: THREE.Vector3): void {
    if (this.muzzleT > 0.02) return;
    this.muzzleLight.position.copy(at);
    this.muzzleT = 0.05;
  }

  /**
   * Task track1-siren-blightbelly-20261031 (lane BLIGHT): an enemy killed by a Blightbelly's blast — the normal kill bookkeeping (stats,
   * death cue, ragdoll). Task studio-refinement-batch-20261113-035659-01: `strength` = the ragdoll impulse (default: the blast's; an
   * acid kill passes its gentler ACID.killImpulse).
   */
  blastKill(z: BlightEnemy, dir: THREE.Vector3, point: THREE.Vector3, strength = killImpulseStrength('shotgun', 6, 9)): void {
    const e = z as EnemyActor;
    if (!this.zombies.includes(e)) return;
    this.stats.kills++;
    enemyCues(e).death(this.sfx, e);
    this.physics.ragdoll(e, {dir, point, strength});
  }

  /**
   * Iteration 16: apply a hit to the player through armor; notifies hitListeners. Other damage sources (falls) use this too.
   * (task studio-alpha-survival-controls-20261107-060450-01) an enemy's attack lands at ENEMY_DAMAGE_TO_PLAYER x its raw amount first
   * (player/hits.ts incomingHit): armour, the injury roll and the HUD all see that hit.
   * (task studio-general-armor-20261107-231448-01) The armour is ONE pool from the worn gear (player/armor.ts armorHit), read before this hit's wear: it cuts an
   * ENEMY hit's damage on any body part, rides on the resolved hit for the injury save, and a hit it mitigated wears ONE contributing
   * item. Non-enemy hits meet no armour.
   */
  applyPlayerHit(raw: PlayerHit): ResolvedHit {
    const hit = incomingHit(raw);
    const {resolved} = armorHit(hit, this.inv.gear, this.wearRand, undefined, this.beerEffects?.tempArmor() ?? 0); // (task studio-market-bar-20261108-225231-01, lane BEER: + Ironclad Stout's temporary armour in the same pool, never worn down)
    this.player.takeDamage(resolved.applied);
    for (const fn of this.hitListeners) fn(resolved);
    return resolved;
  }

  /** (task studio-general-armor-20261107-231448-01) Which worn item a mitigating hit wears: its own stream (the level's seeded stream is never shifted). */
  private readonly wearRand = mulberry32((Math.random() * 0x100000000) >>> 0);

  private die(): void {
    if (this.state !== 'playing') return;
    this.sfx.death();
    this.showEnd('dead');
  }

  private showEnd(kind: 'dead' | 'won'): void {
    const s = this.stats, k = this.run.current;
    const acc = s.shots ? Math.round(s.hits / s.shots * 100) : 0;
    const total = this.layout.zombies.length, down = total - this.zombies.filter(z => z.brain.alive).length;
    // Iteration 16 (RUN): the section / level, its code, this section's kills and the run totals (time, kills, shots, damage)
    const text = `${levelDisplayName(k.level, this.run.seeds[k.level])} · ${sectionLabel(k)} · ${this.layout.name} · code ${seedToCode(this.run.seeds[k.level])}\n`
      + `Run time ${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')} · Infected down here ${down}/${total} · this run ${s.kills}\n`
      + `Shots ${s.shots} · Hits ${s.hits} (${acc}%) · Headshot hits ${s.headshots} · Damage taken ${Math.round(this.player.damageTaken)}`;
    $(kind === 'dead' ? '#death-stats' : '#win-stats').textContent = text;
    this.setState(kind);
  }

  keepExploring(): void {
    void this.enterPlay();
  }

  /** Back-compat (iteration 14 callers): restart(true) = Retry level, restart(false) = New game in the current level. */
  restart(sameSeed: boolean): void {
    void (sameSeed ? this.retryLevel() : this.newGame(this.run.current.level, {enter: true}));
  }

  /** Nearest walkable world point (helper for QA hooks); Lane B: `level` = on that level's grid. */
  snap(x: number, z: number, level = 0): [number, number] | null {
    const g = level > 0 && level < this.levels.count ? this.levels.grid(level) : this.layout.grid;
    const c = nearestWalkable(g, ...g.cellOf(x, z), 4);
    return c ? g.center(c[0], c[1]) : null;
  }
}
