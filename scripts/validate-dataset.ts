// scripts/validate-dataset.ts
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";

const ORIGINAL_HASH_FILE = "dataset.md5";
const CURRENT_DATASET = "/resources/references.json.gz";

if (existsSync(CURRENT_DATASET)) {
    const currentHash = execSync(`md5sum ${CURRENT_DATASET}`).toString().split(" ")[0];
    const originalHash = existsSync(ORIGINAL_HASH_FILE) ? readFileSync(ORIGINAL_HASH_FILE, "utf-8").trim() : "";

    if (currentHash !== originalHash) {
        console.log("⚠️ Dataset changed! Re-running prepare.ts...");
        execSync("bun run scripts/prepare.ts", { stdio: "inherit" });
    } else {
        console.log("✅ Dataset matches pre-baked binary. Skipping preparation.");
    }
} else {
    console.log("ℹ️ No external dataset found. Using pre-baked version.");
}
