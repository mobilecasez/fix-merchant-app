import puppeteer, { Browser } from "puppeteer";

/**
 * Launches a browser instance configured for the current environment.
 * Uses system Chromium on Railway/Docker, or downloads Chrome for local dev.
 */
export async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const isProduction = process.env.NODE_ENV === "production";
  
  // Base args for all environments
  const baseArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled', // Hide automation
    '--disable-infobars',
    '--window-size=1920,1080',
    '--start-maximized',
    '--disable-notifications',
    '--disable-popup-blocking',
  ];

  // Additional args needed for Alpine Linux / containers
  const containerArgs = [
    '--disable-software-rasterizer',
    '--disable-features=VizDisplayCompositor',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--hide-scrollbars',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-zygote',
    '--single-process',
    '--headless=new',
    '--disable-web-security', // May help with some blocks
  ];

  const options: any = {
    headless: true,
    args: isProduction ? [...baseArgs, ...containerArgs] : baseArgs,
  };

  // Use system Chromium if path is set (Railway/Docker)
  if (executablePath) {
    options.executablePath = executablePath;
    console.log(`Using Chromium at: ${executablePath}`);
  }

  try {
    console.log("Launching browser with options:", JSON.stringify({ ...options, args: options.args.length + " args" }));
    const browser = await puppeteer.launch(options);
    console.log("Browser launched successfully");
    return browser;
  } catch (error) {
    console.error("Failed to launch browser:", error);
    throw error;
  }
}
