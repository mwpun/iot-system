import { Routes, Route, Link } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import Navbar from "./component/navbar";
import Header from "./component/header";
import Acc from "./Account.module.css";
import Swal from 'sweetalert2'
import { API_URL } from "./config/apiConfig";


export default function Account() {
  const [user, setUser] = useState([]);
  const [q, setQ] = useState("");
  const token = localStorage.getItem("token"); // ดึง token จาก localStorage

  useEffect(() => {
    axios
      .get(`${API_URL}/api/getDataUser`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setUser(res.data))
      .catch((err) => console.error("❌ Error fetching users:", err));
  }, []);


const remove = async (id, name) => {
  try {
    const result = await Swal.fire({
      title: "Confirm Delete",
      text: `Are you sure you want to delete "${name}"?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "OK",
      cancelButtonText: "Cancel"
    });

    if (!result.isConfirmed) return;

    // ลบ user
    await axios.delete(`${API_URL}/api/DeleteUser/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    // อัปเดต state
    setUser(user.filter(e => e.ID !== id));

    Swal.fire({
      title: "Delete success!",
      text: `User "${name}" is successfully deleted`,
      icon: "success"
    });
  } catch (err) {
    // ดึง message จาก backend หรือ fallback
    const message = err.response?.data?.message || "Failed to delete, an error occurred.";
    Swal.fire("Deleted Failure", message, "error");
  }
};


  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return user;
    return user.filter((e) =>
      [e.ID, e.FNAME, e.LNAME, e.PNAME]
        .join(" ")
        .toLowerCase()
        .includes(t)
    );
  }, [q, user]);

  return (
    <div className={Acc.shell}>
      <Header />

      <section className={Acc.body}>
        <Navbar />
        <main className={Acc.main}>
          <div className={Acc.searchWrapper}>
            <input className={Acc.searchInput}
              placeholder="ค้นหาข้อมูลผู้ใช้งาน…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Link to="/AccountForm" className={Acc.addbtn}>
              เพิ่มข้อมูลผู้ใช้
            </Link>
          </div>

          <div className={Acc.tablewrap}>
            <table className={Acc.gridtable}>
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อ</th>
                  <th>นามสกุล</th>
                  <th>สิทธิการเข้าถึง</th>
                  <th>จัดการข้อมูล</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.ID}>
                    <td>{user.ID}</td>
                    <td>{user.FNAME}</td>
                    <td>{user.LNAME}</td>
                    <td>{user.PNAME}</td>
                    <td className={Acc.actions}>
                      <Link className={`${Acc.btn} ${Acc.blue}`} to={`/AccountForm/${user.ID}`}>
                        แก้ไข
                      </Link>
                      <button
                        className={`${Acc.btn} ${Acc.red}`}
                        onClick={() => remove(user.ID, user.FNAME)}
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan="6" className={Acc.empty}>
                      ไม่พบข้อมูล
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      </section>
    </div>
  );
}
