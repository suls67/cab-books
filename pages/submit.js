import { supabase } from '../supabaseClient';
import { useState } from 'react';

export default function Submit() {
  const [turnover, setTurnover] = useState('');
  const [expenses, setExpenses] = useState('');
  const [result, setResult] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const res = await fetch('/api/hmrc/submitIncome', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify({
        turnover,
        expenses
      })
    });

    const data = await res.json();
    setResult(data);
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Submit Income</h2>

      <form onSubmit={handleSubmit}>
        <div>
          <label>Turnover:</label>
          <input
            type="number"
            value={turnover}
            onChange={(e) => setTurnover(e.target.value)}
            required
          />
        </div>

        <div>
          <label>Expenses:</label>
          <input
            type="number"
            value={expenses}
            onChange={(e) => setExpenses(e.target.value)}
            required
          />
        </div>

        <button type="submit">Submit to HMRC</button>
      </form>

      {result && (
        <pre>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
