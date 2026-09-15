import { BrowserRouter, Route, Routes } from "react-router-dom";
import AddPayment from "./pages/AddPayment";
import Cards from "./pages/Cards";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Payments from "./pages/Payments";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Home />} />
        <Route path="/add" element={<AddPayment />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/cards" element={<Cards />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}
