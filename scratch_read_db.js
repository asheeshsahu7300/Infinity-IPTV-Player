const fs = require('fs');
const buf = fs.readFileSync('scratch_rkstorage.db');
const text = buf.toString('utf16le');
const keys = text.match(/[a-zA-Z0-9_\-\:]{4,60}/g) || [];
console.log("Keys containing portal or channels or last:");
const interesting = keys.filter(k => k.toLowerCase().includes('portal') || k.toLowerCase().includes('channel') || k.toLowerCase().includes('watching') || k.toLowerCase().includes('recent'));
console.log(Array.from(new Set(interesting)));
