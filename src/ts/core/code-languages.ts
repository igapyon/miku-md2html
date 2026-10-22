export type LanguageId =
  | 'markdown'
  | 'java'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'css'
  | 'html'
  | 'xml'
  | 'json'
  | 'bash'
  | 'yaml'
  | 'diff'
  | 'powershell';

export type GrammarId =
  | 'markdown'
  | 'java'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'css'
  | 'xml'
  | 'json'
  | 'bash'
  | 'yaml'
  | 'diff'
  | 'powershell';

export type ResolvedCodeLanguage = {
  language: LanguageId;
  grammar: GrammarId;
};

const aliases = new Map<string, ResolvedCodeLanguage>([
  ['markdown', { language: 'markdown', grammar: 'markdown' }],
  ['md', { language: 'markdown', grammar: 'markdown' }],
  ['java', { language: 'java', grammar: 'java' }],
  ['javascript', { language: 'javascript', grammar: 'javascript' }],
  ['js', { language: 'javascript', grammar: 'javascript' }],
  ['ecmascript', { language: 'javascript', grammar: 'javascript' }],
  ['node', { language: 'javascript', grammar: 'javascript' }],
  ['nodejs', { language: 'javascript', grammar: 'javascript' }],
  ['typescript', { language: 'typescript', grammar: 'typescript' }],
  ['ts', { language: 'typescript', grammar: 'typescript' }],
  ['python', { language: 'python', grammar: 'python' }],
  ['py', { language: 'python', grammar: 'python' }],
  ['python3', { language: 'python', grammar: 'python' }],
  ['css', { language: 'css', grammar: 'css' }],
  ['html', { language: 'html', grammar: 'xml' }],
  ['htm', { language: 'html', grammar: 'xml' }],
  ['xml', { language: 'xml', grammar: 'xml' }],
  ['svg', { language: 'xml', grammar: 'xml' }],
  ['json', { language: 'json', grammar: 'json' }],
  ['shell', { language: 'bash', grammar: 'bash' }],
  ['sh', { language: 'bash', grammar: 'bash' }],
  ['bash', { language: 'bash', grammar: 'bash' }],
  ['yaml', { language: 'yaml', grammar: 'yaml' }],
  ['yml', { language: 'yaml', grammar: 'yaml' }],
  ['diff', { language: 'diff', grammar: 'diff' }],
  ['patch', { language: 'diff', grammar: 'diff' }],
  ['powershell', { language: 'powershell', grammar: 'powershell' }],
  ['pwsh', { language: 'powershell', grammar: 'powershell' }],
  ['ps1', { language: 'powershell', grammar: 'powershell' }],
]);

export function resolveCodeLanguage(info: string | null | undefined): ResolvedCodeLanguage | undefined {
  if (!info) return undefined;
  const token = info.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return token ? aliases.get(token) : undefined;
}
