const fs = require('fs');

const html = fs.readFileSync('test.html', 'utf-8');
console.log('HTML length:', html.length);
console.log();

// Find the colorImages.initial array by locating start position and counting brackets
const colorImagesStartMatch = html.match(/['"']colorImages['"']\s*:\s*\{\s*['"']initial['"']\s*:\s*\[/);

if (colorImagesStartMatch && colorImagesStartMatch.index !== undefined) {
  console.log('✅ Found colorImages.initial start position at:', colorImagesStartMatch.index);
  const startPos = colorImagesStartMatch.index + colorImagesStartMatch[0].length;
  
  // Count brackets to find where the array ends
  let bracketCount = 1; // We already have the opening [
  let endPos = startPos;
  
  while (bracketCount > 0 && endPos < html.length) {
    if (html[endPos] === '[') {
      bracketCount++;
    } else if (html[endPos] === ']') {
      bracketCount--;
    }
    endPos++;
  }
  
  // Extract just the colorImages.initial array content
  const colorImagesArray = html.substring(startPos - 1, endPos);
  console.log('Array length:', colorImagesArray.length);
  console.log();
  console.log('First 500 chars of array:');
  console.log(colorImagesArray.substring(0, 500));
  console.log();
  
  // Now extract hiRes URLs
  const hiResRegex = /"hiRes"\s*:\s*"([^"]+)"/g;
  const images = [];
  let match;
  
  while ((match = hiResRegex.exec(colorImagesArray)) !== null) {
    images.push(match[1]);
  }
  
  console.log(`✅ Extracted ${images.length} images from colorImages.initial array:`);
  console.log();
  images.forEach((img, i) => {
    console.log(`${i + 1}. ${img}`);
  });
  
  // Deduplicate
  const uniqueImages = Array.from(new Set(images));
  console.log();
  console.log(`✅ After removing duplicates: ${uniqueImages.length} unique images`);
} else {
  console.log('❌ Could not find colorImages.initial start');
}
