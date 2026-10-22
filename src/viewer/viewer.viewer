(() => {
  const isJapanese = /^ja(?:-|$)/i.test(document.documentElement.lang);
  const labels = isJapanese
    ? { copy: 'コードをコピー', copied: 'コピーしました。', manual: 'コードを選択しました。手動でコピーしてください。' }
    : { copy: 'Copy code', copied: 'Copied.', manual: 'Code selected. Copy it manually.' };

  for (const pre of document.querySelectorAll('pre')) {
    const code = pre.querySelector(':scope > code');
    if (!code) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'miku-md2html-copy';
    button.setAttribute('aria-label', labels.copy);
    button.title = labels.copy;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z');
    icon.append(path);
    button.append(icon);
    const status = document.createElement('span');
    status.className = 'miku-md2html-copy-status';
    status.setAttribute('aria-live', 'polite');
    button.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(code.textContent ?? '');
        status.textContent = labels.copied;
      } catch {
        const selection = document.getSelection();
        const range = document.createRange();
        range.selectNodeContents(code);
        selection?.removeAllRanges();
        selection?.addRange(range);
        status.textContent = labels.manual;
      }
    });
    pre.prepend(button);
    pre.after(status);
  }
})();
