// Task studio-cosplay-general-20261108-225231-01 (lane COSTUME): configuration of tools/asset-pipeline/zombie/build-cosplay-costumes.mjs.
// Sources are PRIVATE (reference/ is not part of the public repository): the eight Meshy T2.5 smart-topology textured PBR garment
// models the primary generated for this task (Codex INITIAL ghost-mannequin concepts -> image-to-3D; meshy/MANIFEST.json), immutable,
// pinned by sha256 here and verified before and after every build. Bodies are the written runtime wardrobe bodies, read only.
export const TASK = 'studio-cosplay-general-20261108-225231-01 (lane COSTUME)';
export const AUTHORED_ON = '2026-11-09';
export const SOURCE_TASK_DIR = 'reference/tasks/cosplay-bar-feedback-20261108-225231/general-skywalk';
export const RAW_DIR = `${SOURCE_TASK_DIR}/meshy/raw`;
export const MESHY_MANIFEST = `${SOURCE_TASK_DIR}/meshy/MANIFEST.json`;
export const MESHY_REQUEST = {tool: 'meshy_image_to_3d (installed MCP 0.6.6)', ai_model: 'meshy-t2.5', model_type: 'smart-topology', should_texture: true, enable_pbr: true, texture_resolution: '2k', target_formats: ['glb'], target_polycount: 15000};

const tex = (base, metallic, normal, roughness) => ({'base_color.png': base, 'metallic.png': metallic, 'normal.png': normal, 'roughness.png': roughness});

/**
 * The garment masters. fit = tailoring of lib/costume-fit.mjs:
 *  upper: hem = where the hem falls between the body's natural waist (0) and its crotch (1); sleeveEnd = the cuff on the arm chain in
 *         arm units (0 shoulder, 1 elbow, 2 wrist, 3 hand tip); handsCovered = the sleeves end in mitts (the hands inside are hidden);
 *  lower: style 'skirt' (a skirt over separate legwear) | 'trousers'; legFit 'tight' = legwear conformed to the leg; skirtHips
 *         {nude, clothed} = how much of the skirt below the crotch follows the hips instead of the thighs (an unclothed body's skirt
 *         must keep covering in every pose: stiffer); waistOffset (m)
 *         of the waistband top from the natural waist; shoeTop = the footwear's top above its sole (garment units: the colour / section
 *         change measured on the master), below it the footwear is mapped onto the foot box.
 * simplify = the runtime triangle budget (meshoptimizer, UV seams kept; one shared topology for every body).
 */
export const PIECES = {
  'bear-idol-upper': {costume: 'bear-idol', slot: 'upper', label: 'Idol jacket: maroon bodice, cream puffed sleeves, ribbon bow, gold epaulettes',
    meshyTask: '01a1bd6e-1903-734a-9284-6200d1e8bded', concept: {file: 'codex/bear-idol-upper-b.png', sha256: 'c7d508d98b578842a90d60c23030913ba88d28771371bbcc53281258a912d5af'},
    sha256: '3a27add68013bf7edc0a64baf4e9bf36165d3d99729c023e122c0b2031bba1d0',
    textures: tex('9f8887036860dc4f2b65dcf4e28b9faa0a2effe12618323a05b4ee7139d7cdf9', '5341e5ff6ae39df92fdf47b080bd162c27aac788f2b080b6bd8900d420b3f594', 'f74e32337f57487006fbbd36fc369984b0709b21900d7bc87a4f222f7029dbee', '7c18411db4ddb2f5fa25c6bbdeaa90caca330f932ac115243c7451cc4d1b30e2'),
    fit: {hem: 0.35, sleeveEnd: 2.05}, simplify: 6500},
  'bear-idol-lower': {costume: 'bear-idol', slot: 'lower', label: 'Tiered idol skirt, cream thigh-high stockings, maroon platform boots',
    meshyTask: '01a1bd6e-6845-7598-b7a0-6c77454a829f', concept: {file: 'codex/bear-idol-lower.png', sha256: '2253fab1690c826260d8c5c623370cbdd9bb47990ba4ab89715c83a76d753bee'},
    sha256: '40311335a787c7caf9c70d3a829452924140ab8467db5800cd31892d6c8b1848',
    textures: tex('e1eb336ea22945db67bdb23eb7682f4194f569d7ce220f633b72076b104599eb', '060789d4de9fe50eaffa0a9f99eb286bf0faec5ebbe8286d19532c463dc8cd35', 'b1292196ba633c2a54a59c4031154ca63f343369952256974d3205661e561df7', 'e720bd3298629c94a1f4d230760026d7c154d92936e11c7b122c27cf82f0b148'),
    fit: {style: 'skirt', legFit: 'tight', shoeTop: 0.17, skirtHips: {nude: 0.85, clothed: 0.5}}, simplify: 6500},
  'mascot-suit-upper': {costume: 'mascot-suit', slot: 'upper', label: 'Bear kigurumi top: cocoa fleece, cream belly patch, zip, hood, paw mitts',
    meshyTask: '01a1bd6e-7ee2-7222-9257-ce91f6a02a11', concept: {file: 'codex/mascot-suit-upper.png', sha256: 'cfafbad52130aa9ca757d1cc813a4c1ffd6d1753d24217d01b5715e6d237804c'},
    sha256: 'c639e0a4fef27f80f2d27dc74457df542784f4a30b59f96278071138cccd043f',
    textures: tex('35da2deaa5709342eaf194ed9177cc79d89f68488ac2e85d62aad75eda9f0091', 'ee7155e1d38ac59f4c8667b5a1cf8fdb142dd9eb68b835768099f0acd05c1ad4', 'b1c09c6fd5c0e971f998a564d4040fddc0dfa09438a903010a3cbde511d21dea', '84f3f5d71abed1b9b0c28faf95b49db90b1adf4f77fd29b6860eb4ad9b183be3'),
    fit: {hem: 0.6, sleeveEnd: 2.9, handsCovered: true}, simplify: 6000},
  'mascot-suit-lower': {costume: 'mascot-suit', slot: 'lower', label: 'Bear onesie trousers with paw-foot slippers',
    meshyTask: '01a1bd6e-9548-7424-981b-b20cb07e5d7c', concept: {file: 'codex/mascot-suit-lower.png', sha256: 'e50164f342945e1dfc98b4644fb962d010042a4748c4822996d9cb37446b8627'},
    sha256: 'ab4ae01b990b97af18ea227059e1f369a1767bc89b7efc79698d8c91e3780ab4',
    textures: tex('345b12f7c9f41c275ffcccc23cd382f4cd321b86351c3bcb20f3a6d866e53d4c', '45158d32a92ec1cfa09d0f89e7ebeee5a1ba5402bde138fee71efd8ab828ac60', 'c0db1a304f57f61ef3238361655a4561f8def3e122a44691d26cc6879cb5c2db', '699f0f1cb41534f578897b101ce76a2cc1406b34688f952f62e8984a03aa767d'),
    fit: {style: 'trousers', waistOffset: -0.02, shoeTop: 0.12}, simplify: 6000},
  'sushi-fan-upper': {costume: 'sushi-fan', slot: 'upper', label: 'White happi coat, salmon-striped trim, red sash',
    meshyTask: '01a1bd6e-ac42-7141-905f-9edc9d72bb15', concept: {file: 'codex/sushi-fan-upper.png', sha256: '9d61145d096ad43e03de78eabfe99b145634f428232779c297f145f655d3e94b'},
    sha256: 'b31c08f4ad9b7b1b942a2ea25aec76f89f8eec847446fc7622d6a7152163ccfc',
    textures: tex('f698b651dea634168506a4ebd948a747cb47e743f972b80aae884df186663f6d', '3f786c2f238beef65841ef295755b68021ddcf2c545f18763979229c210c4a51', '9a4a0fc2f48f62573f5f7b9f6fc07aeec3e6ab2b5d38fd1fa16eb72ab0437cb6', 'eaf3d32464c8d15430ae145b6d949a8f71ccaa800a40df42440118115deba6ae'),
    fit: {hem: 0.95, sleeveEnd: 1.75}, simplify: 6000},
  'sushi-fan-lower': {costume: 'sushi-fan', slot: 'lower', label: 'Indigo hakama trousers gathered at the ankle, white tabi boots',
    meshyTask: '01a1bd6e-c2cf-76dd-a5d1-0f3a20a5c944', concept: {file: 'codex/sushi-fan-lower.png', sha256: '9296264229b36d45b960f6486397d6a809298587a1f5f52df4587d1803202080'},
    sha256: 'a37a1135ff885863d45302e963fa5f3a88886094f1c952d2f8970db8bf542544',
    textures: tex('6d648a740ba63edf5913ea98738880c62d0f0caf8e1c1bc64e0c7b726d3a4cc3', '8b5f1a0146132b3f9504313e8d6533b09ba30eb21030b5e7673b63765c125272', '8a40414b56d9822e4981385ac3194a417208dd2d6705d1cff9c8a4e75b620c64', '11815355d2736a9ceade6c28cdee4b3e4ea857e45e444c4006310061bcd4bd22'),
    fit: {style: 'trousers', shoeTop: 0.15}, simplify: 6000},
  'rose-uniform-upper': {costume: 'rose-uniform', slot: 'upper', label: 'Navy academy blazer: white sailor collar, rose brooch, pink ribbon, capelet',
    meshyTask: '01a1bd6e-d949-75b5-a615-c117db77cd49', concept: {file: 'codex/rose-uniform-upper.png', sha256: 'bf5117b0954453b39d9c6b856506f81b31a1371100c72654423fd6bab78012ba'},
    sha256: '55a6ca64d823fc6bc0e1908ac9ee6c252b6b2883d0963cd2e00c98c2f15d0bc3',
    textures: tex('b24394d884624e653805c79a0d1eb65622de8ebeca66e6b2bc0c77b107e28e66', '2dbce3c9b07c6446a6350824db9c2c559a7f0922a2e83f6e2e3d23ddc974c65d', '379857a07ec45e2f3077d9c75fdd5afd67e8446542affddce9d1936ee140c092', 'ac5a1bd27733e9e37696ec51319eeea71eb58cb5c5cb488a62b87164a4cf44df'),
    fit: {hem: 0.55, sleeveEnd: 2.02}, simplify: 6000},
  'rose-uniform-lower': {costume: 'rose-uniform', slot: 'lower', label: 'Navy pleated knee skirt, white knee socks, black mary-janes',
    meshyTask: '01a1bd6e-f29b-70bf-9817-df08665852c7', concept: {file: 'codex/rose-uniform-lower.png', sha256: '98a3997cc2e5cb135f5956fcbee741e2b9e8e3f1ea2bd3a795d746432527d599'},
    sha256: 'e3708434a497ee7047b879c1a684cae646117ec9d7741219bb5a9c132ceb2857',
    textures: tex('40f8dd165deec570b18d42a430f9dd1b9eb5b7751a91ade117fe02bd7e4098a3', 'fd17dc87b40f2382295fc34e58cb955b3c8ccdb8cf26f055ef11efbd9deb8cd1', 'c235e308d7b0f84333ca00f04541f7360ff540cd519a5489b2f4cb82d89bcd06', '81dbc85278afaf621205b38ac2e0abba160cb72b8bc2f006284c2729f2626bee'),
    fit: {style: 'skirt', legFit: 'tight', shoeTop: 0.12, skirtHips: {nude: 0.85, clothed: 0.4}}, simplify: 6000},
};
export const PIECE_ORDER = ['bear-idol-upper', 'bear-idol-lower', 'mascot-suit-upper', 'mascot-suit-lower', 'sushi-fan-upper', 'sushi-fan-lower', 'rose-uniform-upper', 'rose-uniform-lower'];

/** The written runtime wardrobe bodies (read only) and their presentation (the convention's female share counts the 'female' ones). */
export const BODIES = {
  lastshift: {file: 'game/public/assets/models/zombie-body-lastshift-t25.glb', sex: 'male'},
  courier: {file: 'game/public/assets/models/zombie-body-courier-t25.glb', sex: 'male'},
  heavyset: {file: 'game/public/assets/models/zombie-body-heavyset-t25.glb', sex: 'male'},
  tall: {file: 'game/public/assets/models/zombie-body-tall-t25.glb', sex: 'female'},
  paleGaze: {file: 'game/public/assets/models/zombie-body-pale-gaze-t25.glb', sex: 'female', nude: true},
  paleRevenant: {file: 'game/public/assets/models/zombie-body-pale-revenant-t25.glb', sex: 'female', nude: true},
  paleApparition: {file: 'game/public/assets/models/zombie-body-pale-apparition-t25.glb', sex: 'female', nude: true},
};
export const BODY_ORDER = ['lastshift', 'courier', 'heavyset', 'tall', 'paleGaze', 'paleRevenant', 'paleApparition'];

/**
 * The costumes: head piece (from the convention mascot / sushi figurine, lib of build-cosplay.mjs; the bear-ear hats carry their wig
 * only on short-haired bodies: on the long-haired pale bodies the hat alone sits on the own hair), upper, lower; the bodies TRIED (a
 * body ships only when every piece passes its gate). Skirted looks on the female bodies; the kigurumi and the happi coat on every
 * presentation (the agent and the masked scavenger are left out: the agent's build is between the two presentations the convention's
 * share is counted on, the scavenger's built-in mask fills the head slot).
 */
export const COSTUMES = [
  {id: 'bear-idol', label: 'Bear idol: bear-ear hat (+ blue wig on short hair), idol jacket, tiered skirt, thigh-highs, platform boots',
    head: {piece: 'bearhat', palette: 'blue'}, upper: 'bear-idol-upper', lower: 'bear-idol-lower', bodies: ['tall', 'paleGaze', 'paleRevenant', 'paleApparition']},
  {id: 'mascot-suit', label: 'Mascot suit: oversized mascot costume head, bear kigurumi top with paw mitts, onesie trousers, paw slippers',
    head: {piece: 'head', fallback: 'bearhat', palette: 'blue'}, upper: 'mascot-suit-upper', lower: 'mascot-suit-lower', bodies: ['lastshift', 'courier', 'heavyset', 'tall', 'paleGaze', 'paleRevenant', 'paleApparition']},
  {id: 'sushi-fan', label: 'Sushi fan: nigiri-sushi mascot hat, happi coat with sash, hakama trousers, tabi boots',
    head: {piece: 'sushi', palette: 'sushi'}, upper: 'sushi-fan-upper', lower: 'sushi-fan-lower', bodies: ['lastshift', 'courier', 'heavyset', 'tall', 'paleGaze', 'paleRevenant', 'paleApparition']},
  {id: 'rose-uniform', label: 'Rose uniform: cream bear-ear hat (+ rose wig on short hair), sailor-collar blazer, pleated skirt, knee socks, mary-janes',
    head: {piece: 'bearhat', palette: 'rose'}, upper: 'rose-uniform-upper', lower: 'rose-uniform-lower', bodies: ['tall', 'paleGaze', 'paleRevenant', 'paleApparition']},
];

/** Runtime textures (the Meshy maps, resized / re-encoded / packed only). */
export const TEXTURES = {baseSize: 1024, baseQuality: 84, normalSize: 512, normalQuality: 88, mrSize: 256, mrQuality: 85};
/** Validation poses: every 0.1 s (every 3rd frame at 30 fps) of all six clips + each clip's last frame. */
export const VALIDATION_STEP = 0.1;
/** Hit-volume bulk caps (m) added by the cloth over the body's measured radii (ai/wardrobe.ts): costumes never balloon the hit volumes. */
export const BULK_CAP = {torso: 0.03, arm: 0.02, leg: 0.025, head: {wig: 0.03, head: 0.08, sushi: 0.02, hat: 0.03}};
