async function fetchTasks() {
    const taskList = document.getElementById('taskList');
    try {
        const response = await fetch('/api/tasks');
        const tasks = await response.json();
        
        if (tasks.length === 0) {
            taskList.innerHTML = '<p class="text-gray-500 italic">No tasks yet.</p>';
            return;
        }

        taskList.innerHTML = tasks.map(task => `
            <div class="border border-gray-700 rounded p-4 bg-gray-750">
                <div class="flex justify-between">
                    <h3 class="font-bold text-lg">${task.objective}</h3>
                    <span class="text-xs px-2 py-1 rounded ${task.result.includes('Success') ? 'bg-green-900 text-green-300' : 'bg-blue-900 text-blue-300'}">${task.result}</span>
                </div>
                <div class="mt-3 bg-gray-900 p-3 rounded text-sm text-gray-300 font-mono">
                    ${task.actionsTaken.map(a => `<span class="text-blue-400">${a.action}:</span> ${a.payload}`).join('<br>')}
                </div>
            </div>
        `).join('');
    } catch (error) {
        taskList.innerHTML = '<p class="text-red-400">Error loading memory.</p>';
    }
}

async function submitTask() {
    const input = document.getElementById('objectiveInput');
    const btn = document.getElementById('submitBtn');
    const status = document.getElementById('statusMessage');
    const objective = input.value.trim();

    if (!objective) return;

    btn.disabled = true;
    status.className = 'mt-3 text-sm text-yellow-400 block';
    status.innerText = 'Task sent to orchestrator...';

    try {
        await fetch('/api/task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ objective })
        });
        input.value = '';
        status.className = 'mt-3 text-sm text-green-400 block';
        status.innerText = 'Agent is running in the background.';
        setTimeout(fetchTasks, 3000); 
    } catch (error) {
        status.className = 'mt-3 text-sm text-red-400 block';
        status.innerText = 'Failed to communicate with server.';
    } finally {
        btn.disabled = false;
    }
}

// Initial load
fetchTasks();
// Auto refresh every 3 seconds to watch live progress
setInterval(fetchTasks, 3000);
