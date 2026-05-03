import { useState } from "react";
import styles from "./Login.module.css";
import logo from "./assets/H.png";
import axios from "axios";
import Swal from "sweetalert2";
import { useNavigate } from "react-router-dom";
import { API_URL } from "./config/apiConfig";

export default function LoginPage() {
  const [form, setForm] = useState({ username: "", password: "" });
  const [loading, setLoading] = useState(false);

  const navigation = useNavigate();

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await axios.post(`${API_URL}/api/login`, {
        ID: form.username,
        Passwd: form.password,
      });

      if (res.data.success) {
        Swal.fire({
          icon: "success",
          title: "เข้าสู่ระบบสำเร็จ",
          text: `ยินดีต้อนรับ ${res.data.user.firstName} ${res.data.user.lastName}`,
        });
        
        localStorage.setItem("token", res.data.token); // ✅ เก็บ token

        navigation('/');

      }
    } catch (err) {
      console.error("Login error:", err);
      Swal.fire({
        icon: "error",
        title: "เข้าสู่ระบบไม่สำเร็จ",
        text: err.response.data.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
            <img src={logo} alt="Healthcare" className={styles.logo} />
        </div>

        <h1 className={styles.title}>Login</h1>

        <form className={styles.form} onSubmit={onSubmit} autoComplete="on">
          <label className={styles.field}>
            <input
              className={styles.input}
              type="text"
              name="username"
              placeholder="Username"
              value={form.username}
              onChange={onChange}
              required
              autoComplete="username"
            />
          </label>

          <label className={styles.field}>
            <input
              className={styles.input}
              type="password"
              name="password"
              placeholder="Password"
              value={form.password}
              onChange={onChange}
              required
              autoComplete="current-password"
            />
          </label>

          <button className={styles.btn} type="submit" disabled={loading}>
            {loading ? "Signing In..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
