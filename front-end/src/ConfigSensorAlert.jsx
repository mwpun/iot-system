import { useEffect, useState } from "react";
import axios from "axios";
import styles from "./ConfigSensorAlert.module.css";
import Navbar from "./component/navbar.jsx";
import Header from "./component/header.jsx";
import Swal from "sweetalert2";
import { API_URL } from "./config/apiConfig";

export default function ConfigSensorAlert() {
  const [configSensor, setConfigSensor] = useState([]);
  const [sensorName, setSensorName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [birthday, setBirthday] = useState("");
  const [editId, setEditId] = useState(null);

  const getAuthHeader = () => {
    const token = localStorage.getItem("token");
    return { Authorization: `Bearer ${token}` };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!sensorName || !roomId || !birthday) {
      Swal.fire("ข้อมูลไม่ครบ", "กรุณากรอกข้อมูลให้ครบ", "warning");
      return;
    }

    try {
      if (editId) {
        const res = await axios.put(
          `${API_URL}/api/updateConfig`,
          { id: editId, roomId, sensorName, birthday },
          { headers: getAuthHeader() }
        );

        if (res.data.status) {
          Swal.fire("สำเร็จ", "แก้ไขข้อมูลแล้ว", "success");
        }
      } else {
        const res = await axios.post(
          `${API_URL}/api/addConfig`,
          { roomId, sensorName, birthday },
          { headers: getAuthHeader() }
        );

        if (res.data.status) {
          Swal.fire("สำเร็จ", "บันทึกข้อมูลแล้ว", "success");
        }
      }

      resetForm();
      fetchConfig();
    } catch (err) {
      console.error("submit error:", err.response?.data || err.message);
      Swal.fire("ผิดพลาด", "ทำรายการไม่สำเร็จ", "error");
    }
  };

  const handleEdit = (s) => {
    setSensorName(s.DEVICE_NAME || "");
    setRoomId(s.ROOMID || "");
    setBirthday(s.DATEOFBIRTH?.split("T")[0] || "");
    setEditId(s.ID);
  };

  const handleDelete = async (s) => {
    const result = await Swal.fire({
      title: "ยืนยันการลบ?",
      text: "ลบแล้วไม่สามารถกู้คืนได้",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "ลบ",
      cancelButtonText: "ยกเลิก",
    });

    if (!result.isConfirmed) return;

    try {
      const res = await axios.delete(
        `${API_URL}/api/deleteConfig`,
        {
          headers: getAuthHeader(),
          data: { id: s.ID, roomId: s.ROOMID },
        }
      );

      if (res.data.status) {
        Swal.fire("ลบแล้ว!", "", "success");
        fetchConfig();
      }
    } catch (err) {
      console.error("delete error:", err.response?.data || err.message);
      Swal.fire("ผิดพลาด", "ลบไม่สำเร็จ", "error");
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await axios.get(
        `${API_URL}/api/getConfig`,
        { headers: getAuthHeader() }
      );
      setConfigSensor(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error("fetchConfig error:", e.response?.data || e.message);
    }
  };

  const resetForm = () => {
    setSensorName("");
    setRoomId("");
    setBirthday("");
    setEditId(null);
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  return (
    <div className={styles.shell}>
      <Header />
      <div className={styles.body}>
        <Navbar />
        <main className={styles.main}>
          <div className={styles.page}>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <h2 className={styles.title}>Sensor Manager</h2>
                  <p className={styles.subtitle}>
                    จัดการข้อมูล sensor และวันเกิดผู้ใช้งาน
                  </p>
                </div>
              </div>

              <form className={styles.form} onSubmit={handleSubmit}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>วันเกิด</label>
                  <input
                    className={styles.input}
                    type="date"
                    value={birthday}
                    onChange={(e) => setBirthday(e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Sensor Name</label>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="กรอกชื่อเซ็นเซอร์"
                    value={sensorName}
                    onChange={(e) => setSensorName(e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Room ID</label>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="กรอก ID ห้อง (เช่น 101)"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                  />
                </div>

                <div className={styles.formActions}>
                  <button className={styles.primaryBtn} type="submit">
                    {editId ? "Update" : "Add"}
                  </button>

                  {editId && (
                    <button
                      className={styles.secondaryBtn}
                      type="button"
                      onClick={resetForm}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div className={styles.card}>
              <div className={styles.tableHeader}>
                <h3 className={styles.tableTitle}>รายการ Sensor</h3>
                <span className={styles.badge}>
                  ทั้งหมด {configSensor.length} รายการ
                </span>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Sensor</th>
                      <th>Birthday</th>
                      <th>Age</th>
                      <th>Baseline HR</th>
                      <th>Baseline RR</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {configSensor.length > 0 ? (
                      configSensor.map((s) => (
                        <tr key={s.ID}>
                          <td>{s.ROOMID || "-"}</td>
                          <td>{s.DEVICE_NAME || "-"}</td>
                          <td>{formatDate(s.DATEOFBIRTH)}</td>
                          <td>{calculateAge(s.DATEOFBIRTH)} ปี</td>
                          <td>{s.BASELINE_HR || "-"}</td>
                          <td>{s.BASELINE_RR || "-"}</td>
                          <td>
                            <div className={styles.actionGroup}>
                              <button
                                className={styles.editBtn}
                                type="button"
                                onClick={() => handleEdit(s)}
                              >
                                Edit
                              </button>
                              <button
                                className={styles.deleteBtn}
                                type="button"
                                onClick={() => handleDelete(s)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className={styles.empty}>
                          ยังไม่มีข้อมูล
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function formatDate(t) {
  if (!t) return "-";
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;

  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function calculateAge(birthdate) {
  if (!birthdate) return "";

  const today = new Date();
  const birth = new Date(birthdate);

  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birth.getDate())
  ) {
    age--;
  }

  return age;
}