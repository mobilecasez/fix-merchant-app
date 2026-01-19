const fs = require('fs');

const html = fs.readFileSync('test.html', 'utf-8');

console.log('HTML length:', html.length);

// Match the colorImages section (from 'colorImages' to the next property)
const colorImagesSectionMatch = html.match(/['"']colorImages['"']\s*:\s*\{[^}]*['"']initial['"']\s*:\s*\[[\s\S]*?\]\s*\}\s*,/m);

if (colorImagesSectionMatch) {
  console.log('\n✅ Found colorImages section');
  const colorImagesSection = colorImagesSectionMatch[0];
  console.log('Section length:', colorImagesSection.length);
  console.log('\nFirst 500 chars of section:');
  console.log(colorImagesSection.substring(0, 500));
  
  // Extract hiRes URLs from this section only
  const hiResRegex = /"hiRes"\s*:\s*"([^"]+)"/g;
  const images = [];
  let match;
  
  while ((match = hiResRegex.exec(colorImagesSection)) !== null) {
    const imageUrl = match[1];
    if (imageUrl && imageUrl !== 'null' && imageUrl.startsWith('http')) {
      images.push(imageUrl);
    }
  }
  
  console.log(`\n✅ Extracted ${images.length} images from colorImages section:\n`);
  images.forEach((img, idx) => {
    console.log(`${idx + 1}. ${img}`);
  });
  
  // Remove duplicates
  const uniqueImages = [...new Set(images)];
  console.log(`\n✅ After removing duplicates: ${uniqueImages.length} unique images`);
} else {
  console.log('❌ Could not find colorImages section');
  
  // Try to understand why
  console.log('\nSearching for colorImages in HTML...');
  if (html.includes('colorImages')) {
    const idx = html.indexOf('colorImages');
    console.log('Found at position:', idx);
    console.log('Context:');
    console.log(html.substring(idx, idx + 200));
  }
}
