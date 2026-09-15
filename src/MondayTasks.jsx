import { useEffect, useState } from 'react';
import { ListTodo } from 'lucide-react';

export default function MondayTasks() {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    fetch('http://localhost:3001/api/monday/tasks')
      .then((response) => response.json())
      .then((result) => {
        if (result.errors) {
          throw new Error(result.errors[0].message);
        }

        const items = result?.data?.boards?.[0]?.items_page?.items ?? [];
        if (active) {
          setTasks(items);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message || 'Unable to load Monday tasks.');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="panel card" style={{ padding: '14px' }}>
      <div className="panel-header">
        <ListTodo size={16} />
        <span>Monday Tasks</span>
      </div>

      {error ? (
        <p style={{ marginTop: 12, color: '#fca5a5' }}>{error}</p>
      ) : (
        <ul className="memory-list" style={{ marginTop: 12 }}>
          {tasks.length === 0 ? (
            <li>No tasks found.</li>
          ) : (
            tasks.map((task) => (
              <li key={task.id}>
                <strong>{task.name}</strong>
                {task.column_values?.length ? (
                  <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
                    {task.column_values
                      .map((column) => column.text)
                      .filter(Boolean)
                      .join(' • ')}
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
