const fs = require('fs');

// Read the test.html file
const html = fs.readFileSync('test.html', 'utf-8');

console.log('HTML length:', html.length);

// OLD REGEX (non-working)
console.log('\n=== OLD REGEX (with P.when and non-greedy *?) ===');
const oldMatch = html.match(/P\.when\(['"]A['"]\)\.register\(['"]ImageBlockATF['"]\s*,\s*function[^]*?'colorImages':\s*{\s*'initial':\s*(\[[\s\S]*?\])\s*\}/m);
if (oldMatch) {
  console.log('✓ Found match');
  console.log('Array length:', oldMatch[1].length);
  console.log('hiRes count:', (oldMatch[1].match(/"hiRes"/g) || []).length);
} else {
  console.log('✗ No match');
}

// NEW REGEX (simplified)
console.log('\n=== NEW REGEX (simplified, greedy) ===');
const newMatch = html.match(/['"']colorImages['"']\s*:\s*{\s*['"']initial['"']\s*:\s*(\[[\s\S]+?\])\s*}/m);
if (newMatch) {
  console.log('✓ Found match');
  console.log('Array length:', newMatch[1].length);
  const hiResCount = (newMatch[1].match(/"hiRes"/g) || []).length;
  console.log('hiRes count:', hiResCount);
  
  console.log('\n📸 Extracting all images:');
  const hiResRegex = /"hiRes"\s*:\s*"([^"]+)"/g;
  const images = [];
  let match;
  while ((match = hiResRegex.exec(newMatch[1])) !== null) {
    images.push(match[1]);
  }
  
  console.log(`\n✅ Successfully extracted ${images.length} images:`);
  images.forEach((img, idx) => {
    console.log(`${idx + 1}. ${img}`);
  });
} else {
  console.log('✗ No match');
}
