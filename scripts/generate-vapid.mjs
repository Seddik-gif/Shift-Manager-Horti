// Prints a fresh VAPID key pair for Web Push. Paste the values into .env.local / your hosting environment.
//   node scripts/generate-vapid.mjs
import { generateVAPIDKeys } from "web-push";

const { publicKey, privateKey } = generateVAPIDKeys();
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
console.log("\nKeep VAPID_PRIVATE_KEY secret. Changing the pair later invalidates every existing subscription.");
