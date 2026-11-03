// Encre : service worker
// Un clic sur l'icône (ou Alt+Maj+D) injecte le script dans l'onglet actif.
// Le script lui-même alterne entre « afficher » et « masquer » s'il est déjà là.

const DEFAULT_TITLE = 'Écrire sur cette page (Alt+Maj+D)';
const BLOCKED_TITLE =
  "Chrome ne permet pas d'écrire sur cette page (pages chrome://, Chrome Web Store, visionneuse PDF).";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  } catch (err) {
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#D7263D' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({ tabId: tab.id, title: BLOCKED_TITLE });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender.tab || sender.tab.id == null || !msg) return;
  const tabId = sender.tab.id;

  if (msg.type === 'encre:state') {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#2350D8' }).catch(() => {});
    chrome.action.setBadgeText({ tabId, text: msg.active ? 'ON' : '' }).catch(() => {});
    chrome.action.setTitle({ tabId, title: DEFAULT_TITLE }).catch(() => {});
    return;
  }

  if (msg.type === 'encre:capture') {
    chrome.tabs
      .captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true; // réponse asynchrone
  }
});

// Le script disparaît quand la page se recharge : on remet le badge à zéro.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    chrome.action.setTitle({ tabId, title: DEFAULT_TITLE }).catch(() => {});
  }
});
