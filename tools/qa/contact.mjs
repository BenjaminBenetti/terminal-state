// Contact sheet: node tools/qa/contact.mjs out.png [--w=640] img...
import sharp from 'sharp';
const args = process.argv.slice(2);
const w = Number((args.find(a => a.startsWith('--w=')) ?? '--w=640').slice(4));
const [out, ...imgs] = args.filter(a => !a.startsWith('--'));
const cols = 2, h = Math.round(w * 9 / 16);
const tiles = await Promise.all(imgs.map(f => sharp(f).resize(w, h, {fit: 'contain', background: '#111'}).png().toBuffer()));
const rows = Math.ceil(tiles.length / cols);
await sharp({create: {width: w * cols, height: h * rows, channels: 3, background: '#111'}})
  .composite(tiles.map((input, i) => ({input, left: (i % cols) * w, top: Math.floor(i / cols) * h}))).png().toFile(out);
console.log(out);
