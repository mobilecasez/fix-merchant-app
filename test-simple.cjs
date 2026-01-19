const fs = require('fs');

// Read the test.html file
const html = fs.readFileSync('test.html', 'utf-8');

console.log('HTML length:', html.length);

// NEW SIMPLE APPROACH: Just search entire HTML for all hiRes
console.log('\n=== SIMPLE APPROACH: Search entire HTML for hiRes ===');
const hiResRegex = /"hiRes"\s*:\s*"([^"]+)"/g;
const images = [];
let match;
let matchCount = 0;

while ((match = hiResRegex.exec(html)) !== null) {
  matchCount++;
  const imageUrl = match[1];
  if (imageUrl && imageUrl !== 'null' && imageUrl.startsWith('http')) {
    images.push(imageUrl);
  }
}

console.log(`\n✅ Found ${matchCount} hiRes fields`);
console.log(`✅ Extracted ${images.length} valid images:\n`);
images.forEach((img, idx) => {
  console.log(`${idx + 1}. ${img}`);
});
