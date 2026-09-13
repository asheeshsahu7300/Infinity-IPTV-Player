const fs = require('fs');
const buf = fs.readFileSync('scratch_mmkv.bin');
const str = buf.toString('latin1');
const matches = str.match(/http[^\x00\s"']+/g) || [];
console.log('Matches count:', matches.length);
console.log('Sample URLs:');
for (const u of matches.slice(0, 20)) {
  console.log(u);
}
