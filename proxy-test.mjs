import { ApifyClient } from "apify-client";
const client = new ApifyClient({ token: "apify_api_E0oK7s9gQ1yJkL5pT4xN3wM8zR6uB2cV1fH9" });
client.task("your-task-id").call().then(console.log).catch(console.error);
