/* ══ 中英双语 / Bilingual UI ══
   语言跟系统走：原生那边在页面加载前写好 window.ANEW_LANG（'zh' / 'en'），没有就看 navigator.language。
   The UI follows the system language. The native shell sets window.ANEW_LANG before the page loads.
   · 代码里的文字写成 L('中文', 'English')。
   · index.html 里写死的文字，在加载时按下面的 STATIC 表换掉（那时还没有用户内容，不会误伤正文）。
   · 存进文件的数据（type: 来源、批注的 kind: 讲一遍）不翻译，只在显示时用 typeLabel / kindLabel 换。 */
const ANEW_LANG = window.ANEW_LANG || (/^zh/i.test(navigator.language || '') ? 'zh' : 'en');
const IS_ZH = ANEW_LANG === 'zh';
function L(zh, en) { return IS_ZH ? zh : en; }
document.documentElement.lang = IS_ZH ? 'zh-CN' : 'en';

// 属性里的类型：文件里可以写中文也可以写英文，程序里一律用中文名比较
// Types in front matter may be written in Chinese or English; internally they are normalized to the Chinese name.
const TYPE_ALIASES = { source: '来源', note: '笔记', think: '要接着想', 'keep-thinking': '要接着想', design: '设计', list: '清单', lookback: '盘一盘' };
const TYPE_EN = { 来源: 'source', 笔记: 'note', 要接着想: 'keep-thinking', 设计: 'design', 清单: 'list', 盘一盘: 'lookback', 学习记录: 'log' };
function normalizeType(t) { const k = String(t || '').trim(); return TYPE_ALIASES[k.toLowerCase()] || k; }
function typeLabel(t) { return IS_ZH ? t : (TYPE_EN[t] || t); }
// 新建时写进文件的类型名：中文系统写中文，英文系统写英文
function typeValue(t) { return IS_ZH ? t : (TYPE_EN[t] || t); }
const KIND_EN = { 讲一遍: 'Retell', 读后感: 'Thoughts', 划线: 'Highlight' };
function kindLabel(k) { return IS_ZH ? k : (KIND_EN[k] || k); }

// index.html 里写死的文字 / static strings in index.html
const STATIC_EN = {
  '知新 Anew': 'Anew',
  '打开别的库文件夹': 'Open another library folder',
  '编辑 Markdown（⌘E）': 'Edit Markdown (⌘E)',
  '编辑': 'Edit',
  '保存（⌘S）': 'Save (⌘S)',
  '保存': 'Save',
  '选一句话复制，贴进你的 AI（如 Claude Code）：处理回响、收网页回响、重整一遍': 'Copy a one-line prompt for your AI agent (e.g. Claude Code): process annotations, collect web highlights, rebuild',
  '交给 AI ▾': 'Hand to AI ▾',
  '学完了，用语音把这件事讲一遍，AI 会指出哪里没讲清、讲错了': 'Explain it back in your own words (voice is fine); the AI points out what you missed or got wrong',
  '讲一遍': 'Retell',
  '插入图片': 'Insert image',
  '把正文和回响一起复制（⇧⌘C）': 'Copy text with annotations (⇧⌘C)',
  '复制给模型': 'Copy for AI',
  '学习时间轴：这几天读了哪几篇、各多久': 'Timeline: what you read these days, and for how long',
  '◷ 时间轴': '◷ Timeline',
  '图谱：这个主题改了几版、观点怎么变的；这一类学到的东西流到了哪': 'Graph: how a topic\'s points changed across versions, and where what you learned flows',
  '◎ 图谱': '◎ Graph',
  '盘一盘：拿你最近 3 天在想的，去翻很早以前的想法和存过的东西（相关 / 惊喜 / 随机）': 'Look back: use what you\'ve been thinking about these 3 days to dig up older ideas and saved things (related / surprise / random)',
  '◐ 盘一盘': '◐ Look back',
  '重新读取磁盘上的最新内容（⌘R）': 'Reload from disk (⌘R)',
  '缩小文字': 'Smaller text',
  '放大文字': 'Larger text',
  '排版': 'Typesetting',
  '切换主题': 'Toggle theme',
  '书库': 'Library',
  '回到书架': 'Back to shelf',
  '库': 'Library',
  '打开单个文件': 'Open a single file',
  '书架': 'Shelf',
  '＋ 把一个文件夹加进书架': '＋ Add a folder to the shelf',
  '打开书库文件夹': 'Open library folder',
  '或打开单个文件': 'or open a single file',
  '最近打开': 'Recent',
  '搜索书库': 'Search library',
  '视图': 'Views',
  '文件夹内容': 'Folder contents',
  '标签': 'Tags',
  '一份真相，两种读法': 'One source of truth, two readers',
  '原稿 · Markdown': 'Source · Markdown',
  'Markdown 编辑器': 'Markdown editor',
  '温故而知新。': 'Read again, learn anew.',
  '一个念头引来一批来源；在来源上划线、写回响，和 AI 辩，理成自己的笔记。': 'A question pulls in sources. Highlight them, write what you think, argue with the AI, and end up with notes of your own.',
  '文档信息': 'Document info',
  '本页链接': 'Links on this page',
  '讲一遍：给没听过的人讲讲它是怎么回事': 'Retell: explain it to someone who has never heard of it',
  '不讲了': 'Cancel',
  '读后感': 'Thoughts',
  '整篇读下来想说的……': 'Your thoughts on the whole piece…',
  '⌘↩ 存': '⌘↩ save',
  '存': 'Save',
  '划线和读后感': 'Highlights & thoughts',
  '已处理 · ': 'Handled · ',
  '条': '',
  '修改记录': 'Edit history',
  '选中一段划线 · 点「交给 AI」': 'Select text to annotate · then Hand to AI',
  '点一下跳到那里': 'Click to jump there',
  '＋ 划线': '＋ Annotate',
  '划线说一句': 'Annotate',
  '写点什么……⌘↩ 保存，Esc 取消': 'Write something… ⌘↩ to save, Esc to cancel',
  '⌘↩ 保存 · Esc 取消': '⌘↩ save · Esc cancel',
  '取消': 'Cancel',
  '新': 'A',
};

function translateStatic(root) {
  if (IS_ZH) return;
  const tr = s => {
    const key = s.trim();
    if (!key || !(key in STATIC_EN)) return null;
    return s.replace(key, STATIC_EN[key]);
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n => { const t = tr(n.nodeValue); if (t != null) n.nodeValue = t; });
  root.querySelectorAll('[title],[placeholder],[aria-label]').forEach(el => {
    ['title', 'placeholder', 'aria-label'].forEach(a => { if (el.hasAttribute(a)) { const t = tr(el.getAttribute(a)); if (t != null) el.setAttribute(a, t); } });
  });
  const t = tr(document.title); if (t != null) document.title = t;
}
translateStatic(document);
