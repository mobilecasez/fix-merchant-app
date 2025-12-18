import puppeteer, { Browser } from "puppeteer";

/**
 * Launches a browser instance configured for the current environment.
 * Uses system Chromium on Railway/Docker, or downloads Chrome for local dev.
 */
export async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  
  const options: any = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  };

  // Use system Chromium if path is set (Railway/Docker)
  if (executablePath) {
    options.executablePath = executablePath;
  }

  return puppeteer.launch(options);
}
