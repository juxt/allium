// Lightweight Allium syntax highlighter
document.addEventListener('DOMContentLoaded', function() {
  var keywords = /^(rule|entity|when|requires|ensures|default|deferred|use|if|let|in|with|for|as|this)$/;

  document.querySelectorAll('code.language-allium').forEach(function(block) {
    var text = block.textContent;
    var result = [];
    var i = 0;

    while (i < text.length) {
      // Comments
      if (text[i] === '/' && text[i + 1] === '/') {
        var end = text.indexOf('\n', i);
        if (end === -1) end = text.length;
        result.push('<span class="allium-comment">' + esc(text.slice(i, end)) + '</span>');
        i = end;
        continue;
      }

      // Strings
      if (text[i] === '"') {
        var j = i + 1;
        while (j < text.length && text[j] !== '"') j++;
        j++; // include closing quote
        result.push('<span class="allium-string">' + esc(text.slice(i, j)) + '</span>');
        i = j;
        continue;
      }

      // Words (identifiers, keywords, types)
      if (/[A-Za-z_]/.test(text[i])) {
        var j = i;
        while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
        var word = text.slice(i, j);
        if (keywords.test(word)) {
          result.push('<span class="allium-keyword">' + esc(word) + '</span>');
        } else if (/^[A-Z]/.test(word)) {
          result.push('<span class="allium-type">' + esc(word) + '</span>');
        } else {
          result.push(esc(word));
        }
        i = j;
        continue;
      }

      // Numbers and durations
      if (/[0-9]/.test(text[i])) {
        var j = i;
        while (j < text.length && /[0-9.]/.test(text[j])) j++;
        // Include trailing unit like .seconds
        if (text[j] === '.' && /[a-z]/.test(text[j + 1])) {
          j++;
          while (j < text.length && /[a-z_]/.test(text[j])) j++;
        }
        result.push('<span class="allium-number">' + esc(text.slice(i, j)) + '</span>');
        i = j;
        continue;
      }

      // Operators
      if (/[=!<>+\-|]/.test(text[i])) {
        var op = text[i];
        if (i + 1 < text.length && text[i + 1] === '=') op += '=';
        result.push('<span class="allium-operator">' + esc(op) + '</span>');
        i += op.length;
        continue;
      }

      // Everything else (whitespace, punctuation)
      result.push(esc(text[i]));
      i++;
    }

    block.innerHTML = result.join('');
  });

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});
