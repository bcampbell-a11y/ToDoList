const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const API_SECRET = process.env.API_SECRET;
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

async function getGist() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const data = await res.json();
  const content = data.files[GIST_FILENAME]?.content;
  if (!content) throw new Error('Gist file not found');
  return JSON.parse(content);
}

async function saveGist(tasks) {
  const files = {};
  files[GIST_FILENAME] = { content: JSON.stringify(tasks, null, 2) };
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files })
  });
  if (!res.ok) throw new Error(`GitHub PATCH failed: ${res.status}`);
  return res.json();
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Auth check for write operations
  const secret = event.headers['x-api-secret'] || event.queryStringParameters?.secret;
  const isWrite = event.httpMethod === 'POST';
  if (isWrite && secret !== API_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // GET — read current tasks
    if (event.httpMethod === 'GET') {
      const data = await getGist();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // POST — write operations
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action, section, task, taskIndex } = body;
      const sectionId = resolveSection(section);

      if (!sectionId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown section: "${section}". Valid sections: Clopay Commercial, Clopay Residential, Williams, Grasshopper, Generac, Ditch Witch Division, EisnerAmper, KZ RV, Littlefield & Other, Priorities` }) };
      }

      const data = await getGist();
      if (!data.sections[sectionId]) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Section not found in data: ${sectionId}` }) };
      }

      data.lastUpdated = new Date().toISOString();

      if (action === 'add') {
        if (!task) return { statusCode: 400, headers, body: JSON.stringify({ error: 'task text required' }) };
        data.sections[sectionId].tasks.push({ text: task, done: false, carryover: false });
        // Update summary
        data.summary.open = (data.summary.open || 0) + 1;
        await saveGist(data);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'added', section: sectionId, task }) };
      }

      if (action === 'complete') {
        const idx = taskIndex !== undefined ? taskIndex : data.sections[sectionId].tasks.findIndex(t => t.text.toLowerCase().includes(task?.toLowerCase()));
        if (idx === -1 || idx === undefined) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Task not found' }) };
        data.sections[sectionId].tasks[idx].done = true;
        data.summary.open = Math.max(0, (data.summary.open || 1) - 1);
        data.summary.done = (data.summary.done || 0) + 1;
        await saveGist(data);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'completed', task: data.sections[sectionId].tasks[idx].text }) };
      }

      if (action === 'delete') {
        const idx = taskIndex !== undefined ? taskIndex : data.sections[sectionId].tasks.findIndex(t => t.text.toLowerCase().includes(task?.toLowerCase()));
        if (idx === -1 || idx === undefined) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Task not found' }) };
        const removed = data.sections[sectionId].tasks.splice(idx, 1)[0];
        if (!removed.done) data.summary.open = Math.max(0, (data.summary.open || 1) - 1);
        await saveGist(data);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'deleted', task: removed.text }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}. Use: add, complete, delete` }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
