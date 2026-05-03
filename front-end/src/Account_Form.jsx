import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Swal from "sweetalert2";
import axios from "axios";
import styles from "./Account_Form.module.css";
import { API_URL } from "./config/apiConfig";

export default function AccountForm() {
  const nav = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [isSuccess, setIsSuccess] = useState(null);
  const token = localStorage.getItem("token"); // ดึง token จาก localStorage


const [form, setForm] = useState({
  ID: "",
  FNAME: "",
  LNAME: "",
  USERNAME: "",
  PASSWORD: "",
  ACRID: ""
});


  const [access_right, setAccessRight] = useState([]);

  useEffect(() => {
  if (!isEdit) {
    axios.get(`${API_URL}/api/getDataUser/lastid`,{ headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        const lastUserId = res.data?.ID || 0;     // ค่าล่าสุดจาก DB

        // Gen ID ถัดไป
        const nextUserId = lastUserId + 1;

        setForm((prev) => ({
          ...prev,
          ID: nextUserId,
        }));
      })
  }
}, [isEdit]);

  useEffect(() => {
    axios.get(`${API_URL}/api/getAccessRight`,{ headers: { Authorization: `Bearer ${token}` } }).then((res) =>
      setAccessRight(res.data)
    );

  }, []);

  useEffect(() => {
    if (isEdit) {
      axios.get(`${API_URL}/api/getDataUser/${id}`,{ headers: { Authorization: `Bearer ${token}` } }).then((res) => {
        const e = Array.isArray(res.data) ? res.data[0] : res.data;
        console.log(e)
        setForm(e);
      });
    }
  }, [isEdit, id]);

  //console.log(employees)

  const submit = async (e) => {
    e.preventDefault();
    //console.log(form)
    try {
      if (isEdit) {
        await axios.put(`${API_URL}/api/UpdateUser/${id}`, form,{ headers: { Authorization: `Bearer ${token}` } })
        .then(res=>{
          Swal.fire("Edited successfully!", res.data.message, "success");
        })
      } else {
        await axios.post(`${API_URL}/api/UpdateUser`, form,{ headers: { Authorization: `Bearer ${token}` } })
        .then(res=>{
          Swal.fire("Added successfully!", res.data.message, "success");
        });  // ← เพิ่มต้องมา endpoint นี้
      }
      nav("/Account");
    } catch (err) {
      console.error("❌ Error saving:", err);
      setIsSuccess(err.response.data);
      Swal.fire("เกิดข้อผิดพลาด", "", "error");
    }
  };

  console.log(isSuccess)

  return (
    <section className={styles.card}>
      <h3>{isEdit ? "แก้ไขพนักงาน" : "เพิ่มพนักงาน"}</h3>
      <form onSubmit={submit} className={styles.formgrid}>

        <label className={styles.field}>
          <span>รหัส</span>
          <input
            value={form.ID || ""}
            onChange={(e) => setForm({ ...form, ID: e.target.value })}
            style={{opacity:'0.7' , color:'gray'}}
            disabled={isEdit}
            readOnly
          />
        </label>
        <label className={styles.field}>
          <span>ชื่อ</span>
          <input
            value={form.FNAME || ""}
            onChange={(e) => setForm({ ...form, FNAME: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>นามสกุล</span>
          <input
            value={form.LNAME || ""}
            onChange={(e) => setForm({ ...form, LNAME: e.target.value })}
          />
        </label>
        
        <label className={styles.field}>
          <span>Username</span>
          <input
            value={form.USERNAME || ""}
            onChange={(e) => setForm({ ...form, USERNAME: e.target.value })}
          />
          { 
            !isSuccess?.success ? <p style={{color:'red', fontSize:'14px'}}>{isSuccess?.message}</p> : ''
          }
        </label>
        <label className={styles.field}>
          <span>Password</span>
          <input
            type="password"
            value={form.PASSWORD || ""}
            onChange={(e) => e.target.value !== "" ? setForm({ ...form, PASSWORD: e.target.value }) : ''}
          />
        </label>

        <label className={styles.field}>
          <span>สิทธิการเข้าถึง</span>
          <select
            value={form.ACRID || ""}
            onChange={(e) => setForm({ ...form, ACRID: e.target.value })}
          >
            <option value="" hidden>-- เลือกสิทธิการเข้าถึง --</option>
            {access_right.map((ar, i) => (
              <option key={i} value={ar.ID}>
                {ar.NAME}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.formactions}>
          <button className={`${styles.btn} ${styles.green}`} type="submit">
            {isEdit ? "บันทึก" : "เพิ่ม"}
          </button>
          <button
            className={styles.btn}
            type="button"
            onClick={() => nav("/Account")}
          >
            ยกเลิก
          </button>
        </div>
      </form>
    </section>
  );
}
