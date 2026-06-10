import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Sentinel "shop" used for seeded requests/votes so they're never treated as a
// real merchant's own request (the UI compares createdByShop === session.shop).
const TEAM = 'shopflix-team';

// Honest starter roadmap: "done" items are features genuinely shipped; the rest
// invite voting. Vote counts are seed values — the owner can delete any of these
// from the Feature Requests page at any time.
const SEED = [
  { key: 'auto-fix', status: 'done', votes: 11, title: 'One-click auto-fix for policy pages, footer links & contact info',
    description: 'Generate and apply the missing GMC pages and footer links directly in my store without copy-pasting.' },
  { key: 'suspension', status: 'done', votes: 9, title: 'AI Suspension Recovery — diagnosis + reinstatement appeal letter',
    description: 'When my account is suspended, diagnose the likely cause and draft a professional appeal letter I can submit to Google.' },
  { key: 'image-fixer', status: 'done', votes: 7, title: 'AI Image Compliance Fixer (white background, remove watermarks/promo text)',
    description: 'Automatically fix product images Google rejects so they pass Merchant Center image policy.' },
  { key: 'free-scan', status: 'done', votes: 5, title: 'Free first compliance scan for every new store',
    description: 'Let merchants run their first full Basic scan free before spending credits.' },
  { key: 'bulk-fix', status: 'planned', votes: 8, title: 'Bulk auto-fix across all products in one click',
    description: 'Apply the same fix (identifiers, descriptions, images) to many products at once instead of one by one.' },
  { key: 'weekly-score', status: 'planned', votes: 4, title: 'Weekly emailed compliance score & change report',
    description: 'Send me a short weekly email with my store’s compliance score and anything that changed.' },
  { key: 'gtin-lookup', status: 'open', votes: 6, title: 'Auto-lookup GTIN/MPN for products missing identifiers',
    description: 'Find the correct GTIN/barcode for my products automatically so they stop getting disapproved.' },
  { key: 'channel-alerts', status: 'open', votes: 3, title: 'Slack / Discord alerts when a new compliance issue appears',
    description: 'Notify my team in Slack or Discord the moment monitoring detects a new issue.' },
  { key: 'multilang', status: 'open', votes: 2, title: 'Generate policy pages in multiple languages',
    description: 'Create compliant policy pages translated for my international storefronts.' },
];

async function main() {
  console.log('Seeding feature requests...');
  const existing = await prisma.featureRequest.count();
  if (existing > 0) {
    console.log(`Found ${existing} feature request(s) — skipping seed.`);
    return;
  }

  for (const item of SEED) {
    const voteShops = [TEAM, ...Array.from({ length: Math.max(0, item.votes - 1) }, (_, i) => `seed-${item.key}-${i}`)];
    await prisma.featureRequest.create({
      data: {
        title: item.title,
        description: item.description,
        tags: '',
        status: item.status,
        createdByShop: TEAM,
        votes: { create: voteShops.map((shop) => ({ shop })) },
      },
    });
    console.log(`✓ Seeded: ${item.title} (${item.status}, ${item.votes} votes)`);
  }
  console.log('\n✓ Feature requests seeded.');
}

main()
  .catch((e) => {
    // Non-critical: never block app startup on a seed failure.
    console.error('Feature-request seed skipped (non-fatal):', e?.message || e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
