const GIST_ID = process.env.GIST_ID || '4d77effa39d809e9d22c378a06ea584a';
const API_SECRET = process.env.API_SECRET || 'Boulder1350!';
const GIST_FILENAME = 'claude-weekly-todo.json';

const SECTION_IDS = {
  'priorities': 'priorities',
  "today's priorities": 'priorities',
  'clopay commercial': 'clopay_comm',
  'clopay_comm': 'clopay_comm',
  'clopay residential': 'clopay_resi',
  'clopay_resi': 'clopay_resi',
  'williams': 'williams',
  'grasshopper': 'grasshopper',
  'generac': 'generac',
  'ditch witch': 'ditch_witch',
  'ditch witch division': 'ditch_witch',
  'ditch_witch': 'ditch_witch',
  'eisneramper': 'eisneramper',
  'kz rv': 'kz_rv',
  'kz_rv': 'kz_rv',
  'littlefield': 'littlefield',
  'littlefield & other': 'littlefield',
  'littlefield and other': 'littlefield',
};

function resolveSection(name) {
  if (!name) return null;
  return SECTION_IDS[name.toLowerCase().trim()] || null;
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Secret, X-GitHub-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const githubToken = process.env.GITHUB_TOKEN || event.headers['x-github-token'];
  if (!githubToken) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'GitHub token not configured' }) };
  }

  const secret = event.headers['x-api-secret'] || (event.queryStringParameters && event.queryStringParameters.secret);
  if (event.httpMethod === 'POST' && secret !== API_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  async function getGist() {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
    const data = await res.json();
    const content = data.files[GIST_FILENAME] && data.files[GIST_FILENAME].content;
    if (!content) throw new Error('Gist file not found');
    return JSON.parse(content);
  }

  async function saveGist(data) {
    const files = {};
    files[GIST_FILENAME] = { content: JSON.stringify(data, null, 2) };
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: { 'Authorization': `token ${githubToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files })
    });
    if (!res.ok) throw new Error(`GitHub PATCH failed: ${res.status}`);
    return res.json();
  }

  try {
    if (event.httpMethod === 'GET') {
      const data = await getGist();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action, section, task, taskIndex, data: replaceData } = body;

      if (action === 'replace') {
        if (!replaceData) return { statusCode: 400, headers, body: JSON.stringify({ error: 'data required for replace action' }) };
        replaceData.lastUpdated = new Date().toISOString();
        await saveGist(replaceData);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'replaced' }) };
      }

      if (action === 'add') {
        const sectionId = resolveSection(section);
        if (!sectionId) return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown section: "${section}"` }) };
        if (!task) return { statusCode: 400, headers, body: JSON.stringify({ error: 'task text required' }) };
        const data = await getGist();
        if (!data.sections || !data.sections[sectionId]) return { statusCode: 400, headers, body: JSON.stringify({ error: `Section not found: ${sectionId}` }) };
        data.sections[sectionId].tasks.push({ text: task, done: false, carryover: false });
        data.summary.open = (data.summary.open || 0) + 1;
        data.lastUpdated = new Date().toISOString();
        await saveGist(data);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'added', section: sectionId, task }) };
      }

      if (action === 'complete') {
        const sectionId = resolveSection(section);
        if (!sectionId) return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown section: "${section}"` }) };
        const data = await getGist();
        const tasks = data.sections[sectionId] && data.sections[sectionId].tasks;
        if (!tasks) return { statusCode: 400, headers, body: JSON.stringify({ error: `Section not found: ${sectionId}` }) };
        const idx = taskIndex !== undefined ? taskIndex : tasks.findIndex(function(t) { return t.text.toLowerCase().indexOf((task || '').toLowerCase()) !== -1; });
        if (idx === -1) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Task not found' }) };
        tasks[idx].done = true;
        data.summary.open = Math.max(0, (data.summary.open || 1) - 1);
        data.summary.done = (data.summary.done || 0) + 1;
        data.lastUpdated = new Date().toISOString();
        await saveGist(data);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'completed', task: tasks[idx].text }) };
      }

      if (action === 'delete') {
        const sectionId = resolveSection(section);
        if (!sectionId) return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown section: "${section}"` }) };
        const data = await getGist();
        const tasks = data.sections[sectionId] && data.sections[sectionId].tasks;
        if (!tasks) return { statusCode: 400, headers, body: JSON.stringify({ error: `Section not found: ${sectionId}` }) };
        const idx = taskIndex !== undefined ? taskIndex : tasks.findIndex(function(t) { return t.text.toLowerCase().indexOf((task || '').toLowerCase()) !== -1; });
        if (idx === -1) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Task not found' }) };
        const removed = tasks.splice(idx, 1)[0];
        if (!removed.done) data.summary.open = Math.max(0, (data.summary.open || 1) - 1);
        data.lastUpdated = new Date().toISOString();
        await saveGist(data);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'deleted', task: removed.text }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}. Use: replace, add, complete, delete` }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
