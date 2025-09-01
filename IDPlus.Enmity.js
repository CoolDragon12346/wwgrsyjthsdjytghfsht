/*
 * IDPlus (Enmity) - Minimal Valid Plugin
 * This is the correct structure for "Install from file".
 * It will load and show a toast when enabled.
 */

function safeRequire(path) { try { return require(path); } catch { return null; } }

const { registerPlugin } = safeRequire("enmity/managers/plugins") || {};
const { Toasts } = safeRequire("enmity/metro/common") || {};

const Plugin = {
  name: "IDPlus (Enmity)",
  onStart() {
    Toasts?.open?.({ content: "✅ IDPlus plugin loaded!", source: "ic_check" });
  },
  onStop() {
    Toasts?.open?.({ content: "❌ IDPlus plugin stopped.", source: "ic_close" });
  },
  settings: () => null // settings screen placeholder
};

// Export in both supported ways (covers all Enmity builds)
module.exports = registerPlugin ? registerPlugin(Plugin) : Plugin;
