const fs = require('fs');

const buf = fs.readFileSync('scratch_mmkv.bin');
const text = buf.toString('utf16le');

// Search for VOD cmds (e.g. /media/ or movie or series)
const vodCmds = text.match(/(?:ffmpeg\s+|auto\s+|ffrt\s+)?(?:\/media\/|http[^\s"'\x00]+)(?:\.mpg|\.mp4|\.mkv|\.m3u8)[^\s"'\x00]*/gi) || [];
console.log("VOD cmds found:", vodCmds.length);
console.log("Sample VOD cmds:\n", Array.from(new Set(vodCmds)).slice(0, 20).join('\n'));

// Search for any other cmd patterns
const allCmds = text.match(/(?:ffmpeg|ffrt|auto)\s+[^\s"'\x00]+/gi) || [];
console.log("\nTotal prefixed cmds:", allCmds.length);
console.log("Sample prefixed cmds (non-localhost):\n", Array.from(new Set(allCmds.filter(c => !c.includes('localhost')))).slice(0, 20).join('\n'));
