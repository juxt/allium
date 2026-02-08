// Allium syntax highlighter
document.addEventListener('DOMContentLoaded', function() {
  var keywords = /^(rule|entity|when|requires|ensures|default|deferred|use|if|let|in|with|for|as|this)$/;
  var builtins = /^(now|true|false|none)$/;

  document.querySelectorAll('code.language-allium').forEach(function(block) {
    var text = block.textContent;
    var result = [];
    var i = 0;

    while (i < text.length) {
      // Comments
      if (text[i] === '/' && text[i + 1] === '/') {
        var end = text.indexOf('\n', i);
        if (end === -1) end = text.length;
        result.push(span('comment', text.slice(i, end)));
        i = end;
        continue;
      }

      // Strings
      if (text[i] === '"') {
        var j = i + 1;
        while (j < text.length && text[j] !== '"') j++;
        j++;
        result.push(span('string', text.slice(i, j)));
        i = j;
        continue;
      }

      // Dot access: .property
      if (text[i] === '.' && i + 1 < text.length && /[a-z_]/.test(text[i + 1])) {
        var j = i + 1;
        while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
        result.push(span('punctuation', '.'));
        result.push(span('property', text.slice(i + 1, j)));
        i = j;
        continue;
      }

      // Words
      if (/[A-Za-z_]/.test(text[i])) {
        var j = i;
        while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
        var word = text.slice(i, j);

        // Check if followed by colon (field label)
        var afterWord = j;
        while (afterWord < text.length && text[afterWord] === ' ') afterWord++;

        if (keywords.test(word)) {
          result.push(span('keyword', word));
        } else if (builtins.test(word)) {
          result.push(span('builtin', word));
        } else if (/^[A-Z]/.test(word)) {
          result.push(span('type', word));
        } else if (text[afterWord] === ':') {
          result.push(span('field', word));
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
        if (text[j] === '.' && j + 1 < text.length && /[a-z]/.test(text[j + 1])) {
          j++;
          while (j < text.length && /[a-z_]/.test(text[j])) j++;
        }
        result.push(span('number', text.slice(i, j)));
        i = j;
        continue;
      }

      // Operators
      if (/[=!<>+\-|]/.test(text[i])) {
        var op = text[i];
        if (i + 1 < text.length && text[i + 1] === '=') op += '=';
        result.push(span('operator', op));
        i += op.length;
        continue;
      }

      // Punctuation
      if (/[{}()\[\]:,?\/]/.test(text[i])) {
        result.push(span('punctuation', text[i]));
        i++;
        continue;
      }

      // Everything else
      result.push(esc(text[i]));
      i++;
    }

    block.innerHTML = result.join('');
  });

  function span(cls, s) {
    return '<span class="allium-' + cls + '">' + esc(s) + '</span>';
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});
