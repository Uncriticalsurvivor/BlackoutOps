import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Join from './pages/Join';
import Instructor from './pages/Instructor';
import Player from './pages/Player';
import AAR from './pages/AAR';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:sessionId" element={<Join />} />
        <Route path="/instructor/:sessionId" element={<Instructor />} />
        <Route path="/player/:sessionId" element={<Player />} />
        <Route path="/aar/:sessionId" element={<AAR />} />
      </Routes>
    </BrowserRouter>
  );
}
