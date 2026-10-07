// 知新 Anew 插件的后台：转发给本机（写库）、图标和右键菜单。
const HOST = 'com.anew.clip';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'anew-note', title: chrome.i18n.getMessage('menuNote'), contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'anew-mark', title: chrome.i18n.getMessage('menuMark'), contexts: ['selection'] });
});

const tell = (tabId, msg) => tabId && chrome.tabs.sendMessage(tabId, msg).catch(() => {});

chrome.action.onClicked.addListener(tab => tell(tab.id, { type: 'toggle-panel' }));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'anew-note') tell(tab.id, { type: 'note-selection' });
  if (info.menuItemId === 'anew-mark') tell(tab.id, { type: 'mark-selection' });
});
chrome.commands.onCommand.addListener((command, tab) => tell(tab && tab.id, { type: command }));

// 页面上的划线数挂在图标上
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'badge') {
    const tabId = sender.tab && sender.tab.id;
    chrome.action.setBadgeBackgroundColor({ tabId, color: msg.saved ? '#4e6a53' : '#b07642' });
    chrome.action.setBadgeText({ tabId, text: msg.count ? String(msg.count) : '' });
    return;
  }
  if (msg.type === 'native') {
    chrome.runtime.sendNativeMessage(HOST, msg.body, response => {
      if (chrome.runtime.lastError) reply({ ok: false, error: chrome.runtime.lastError.message, noHost: true });
      else reply(response || { ok: false, error: chrome.i18n.getMessage('noReply') });
    });
    return true;   // 异步回
  }
});
