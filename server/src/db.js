/* =========================================================
   Koneksi MySQL (connection pool)
   ========================================================= */

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smartabs',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true   // DATE/TIME dikembalikan sebagai string 'YYYY-MM-DD' / 'HH:MM:SS'
});

/* SELECT / query biasa -> array baris. Selalu gunakan placeholder (?) —
   jangan pernah menyambung input pengguna langsung ke string SQL. */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/* Jalankan beberapa query dalam satu transaksi */
async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const tx = {
      async query(sql, params = []) {
        const [rows] = await connection.execute(sql, params);
        return rows;
      },
      async queryOne(sql, params = []) {
        const [rows] = await connection.execute(sql, params);
        return rows[0] || null;
      }
    };

    const result = await work(tx);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { pool, query, queryOne, transaction };
