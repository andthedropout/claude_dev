import { AppLayout } from '@/components/layout/AppLayout';
import { Board } from '@/components/kanban/Board';
import './App.css';

function App() {
  return (
    <AppLayout>
      <Board />
    </AppLayout>
  );
}

export default App;
