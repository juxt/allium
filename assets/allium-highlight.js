// Lightweight Allium syntax highlighter
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('code.language-allium').forEach(function(block) {
    var html = block.textContent;

    // Escape HTML
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Comments
    html = html.replace(/(\/\/.*)/g, '<span class="allium-comment">$1</span>');

    // Strings
    html = html.replace(/"([^"]*)"/g, '<span class="allium-string">"$1"</span>');

    // Numbers and durations
    html = html.replace(/\b(\d+(?:\.\w+)?)\b/g, '<span class="allium-number">$1</span>');

    // Keywords
    html = html.replace(/\b(rule|entity|when|requires|ensures|default|deferred|use|if|let|in|with|for|as)\b/g,
      '<span class="allium-keyword">$1</span>');

    // Types and rule names (capitalised words)
    html = html.replace(/\b([A-Z][A-Za-z_]+)\b/g, '<span class="allium-type">$1</span>');

    // Operators
    html = html.replace(/([=!<>]=?|\||\+|-|>=|<=)/g, '<span class="allium-operator">$1</span>');

    block.innerHTML = html;
  });
});
