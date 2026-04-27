// Curated English + dev-noise stopwords. Treat as fixed for v1; tuning is a follow-up pass.
export const STOPWORDS = new Set<string>([
  // English
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was', 'one',
  'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see',
  'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'with',
  'this', 'that', 'from', 'have', 'they', 'will', 'would', 'there', 'their', 'what', 'about',
  'which', 'when', 'make', 'like', 'into', 'time', 'than', 'first', 'been', 'call', 'find',
  'long', 'down', 'come', 'made', 'part', 'over', 'such', 'take', 'only', 'know', 'look',
  'also', 'back', 'after', 'work', 'because', 'some', 'most', 'these', 'them', 'were', 'been',
  'being', 'does', 'each', 'just', 'more', 'much', 'must', 'other', 'same', 'used', 'very',
  'where', 'while', 'your', 'yours',
  // Dev noise (low discriminating power in repo descriptions)
  'tool', 'tools', 'app', 'apps', 'application', 'applications', 'library', 'libraries',
  'framework', 'frameworks', 'project', 'projects', 'code', 'simple', 'easy', 'fast',
  'lightweight', 'modern', 'awesome', 'best', 'small', 'minimal', 'clean', 'free', 'open',
  'source', 'using', 'made', 'built', 'build', 'support', 'supports', 'feature', 'features',
  'help', 'helps', 'helper', 'helpers', 'make', 'makes', 'making', 'create', 'creates',
  'creating', 'used', 'use', 'uses', 'using', 'works', 'work', 'working', 'based',
])
