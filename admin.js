/* ═══════════════════════════════════════════════════════════
   VASCA ADMIN — Appointment Manager (Supabase)
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ─── AUTH CHECK ──────────────────────────────────────────
  const adminToken = localStorage.getItem("vasca_token");
  const userRole = localStorage.getItem("vasca_role");
  if (!adminToken || userRole !== "admin") {
    window.location.href = "login.html";
    return;
  }

  // ─── CONFIG ────────────────────────────────────────────
  const SUPABASE_URL = "https://mxoztaxlcciqrdejfpum.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14b3p0YXhsY2NpcXJkZWpmcHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MTQ3NzksImV4cCI6MjA5NDE5MDc3OX0.bwE9e5P2UvqAC9VauZVk1q6j19mnDkAptXMOTEiKhJA";

  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${adminToken}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };

  // ─── LOGOUT ────────────────────────────────────────────
  window.logoutAdmin = function () {
    localStorage.removeItem("vasca_token");
    localStorage.removeItem("vasca_refresh");
    localStorage.removeItem("vasca_user");
    localStorage.removeItem("vasca_role");
    window.location.href = "login.html";
  };

  // ─── STATE ─────────────────────────────────────────────
  let professionals = [];
  let services = [];
  let prices = [];
  let calendarDate = new Date();
  let selectedCalDay = null;
  let monthAppointments = [];

  // ─── API HELPERS ───────────────────────────────────────
  async function api(table, query = "", opts = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${table}${query ? "?" + query : ""}`;
    const res = await fetch(url, { headers: { ...headers, ...opts.headers }, method: opts.method || "GET", body: opts.body });
    if (!res.ok) { const err = await res.text(); throw new Error(err); }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function today() { return new Date().toISOString().split("T")[0]; }

  function formatDate(d) {
    const date = new Date(d + "T12:00:00");
    return date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  }

  function formatTime(t) { return t.substring(0, 5); }

  // ─── INIT ──────────────────────────────────────────────
  async function init() {
    setupNav();
    setupMobileMenu();
    setHeaderDate();

    // Load base data
    [professionals, services, prices] = await Promise.all([
      api("professionals", "select=*&is_active=eq.true&order=sort_order"),
      api("services", "select=*&is_active=eq.true&order=sort_order"),
      api("service_professional_prices", "select=*,services(name),professionals(name)&is_active=eq.true")
    ]);

    populateFormSelects();
    setupFormListeners();
    loadDashboard();
  }

  // ─── NAVIGATION ────────────────────────────────────────
  function setupNav() {
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
        document.getElementById(`view-${view}`).classList.add("active");
        document.getElementById("page-title").textContent = btn.textContent.trim();
        // Close sidebar on mobile
        document.getElementById("sidebar").classList.remove("open");
        // Load view data
        if (view === "dashboard") loadDashboard();
        if (view === "calendar") renderCalendar();
        if (view === "clients") loadClients();
      });
    });
  }

  function setupMobileMenu() {
    document.getElementById("menu-toggle").addEventListener("click", () => {
      document.getElementById("sidebar").classList.toggle("open");
    });
  }

  function setHeaderDate() {
    const d = new Date();
    document.getElementById("header-date").textContent =
      d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  // ─── DASHBOARD ─────────────────────────────────────────
  let tomorrowAppts = [];

  async function loadDashboard() {
    // Skeleton loading
    const statIds = ["stat-today", "stat-week", "stat-pending", "stat-clients"];
    statIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = "—"; });
    const todayList = document.getElementById("today-appointments");
    if (todayList) todayList.innerHTML = '<div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>';

    const todayStr = today();
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    const tomorrowStr = tmrw.toISOString().split("T")[0];

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const [todayApptsList, weekAppts, pendingAppts, clientsCount, tmrwAppts] = await Promise.all([
      api("appointments", `select=*,clients(full_name,phone,instagram),professionals(name,color),services(name,duration_minutes)&appointment_date=eq.${todayStr}&status=neq.cancelled&order=start_time`),
      api("appointments", `select=id&appointment_date=gte.${weekStart.toISOString().split("T")[0]}&appointment_date=lte.${weekEnd.toISOString().split("T")[0]}&status=neq.cancelled`),
      api("appointments", `select=id&status=eq.pending`),
      api("clients", `select=id`, { headers: { "Prefer": "count=exact" } }),
      api("appointments", `select=*,clients(full_name,phone),professionals(name),services(name)&appointment_date=eq.${tomorrowStr}&status=neq.cancelled&order=start_time`)
    ]);

    tomorrowAppts = tmrwAppts;

    document.getElementById("stat-today").textContent = todayApptsList.length;
    document.getElementById("stat-week").textContent = weekAppts.length;
    document.getElementById("stat-pending").textContent = pendingAppts.length;
    document.getElementById("stat-clients").textContent = clientsCount.length;

    renderAppointmentsList("today-appointments", todayApptsList);
    renderReminders();
  }

  function renderReminders() {
    const container = document.getElementById("tomorrow-reminders");
    const sent = JSON.parse(localStorage.getItem("vasca_reminders_sent") || "{}");

    if (!tomorrowAppts.length) {
      container.innerHTML = `<p class="empty-msg">No hay turnos mañana</p>`;
      document.getElementById("btn-send-all").style.display = "none";
      return;
    }
    document.getElementById("btn-send-all").style.display = "";

    container.innerHTML = tomorrowAppts.map(a => {
      const name = a.clients?.full_name || "Clienta";
      const phone = a.clients?.phone || "";
      const svc = a.services?.name || "";
      const prof = a.professionals?.name || "";
      const wasSent = sent[a.id];
      return `
      <div class="appt-card" data-id="${a.id}">
        <div class="appt-time">${formatTime(a.start_time)}</div>
        <div class="appt-info">
          <h4>${name}</h4>
          <p>${svc} · ${prof}</p>
        </div>
        <div class="appt-actions">
          ${wasSent
            ? `<span class="appt-status status-confirmed">✓ Enviado</span>`
            : `<button class="action-btn" onclick="vasca.sendReminder('${a.id}','${phone.replace(/'/g,"\\'")}','${name.replace(/'/g,"\\'")}','${svc.replace(/'/g,"\\'")}','${a.appointment_date}','${a.start_time}')">📲 Recordar</button>`
          }
        </div>
      </div>`;
    }).join("");
  }

  function renderAppointmentsList(containerId, appointments) {
    const container = document.getElementById(containerId);
    if (!appointments.length) {
      container.innerHTML = `<p class="empty-msg">No hay turnos</p>`;
      return;
    }
    container.innerHTML = appointments.map(a => {
      const cName = (a.clients?.full_name || 'Clienta').replace(/'/g, "\\'");
      const cPhone = (a.clients?.phone || '').replace(/'/g, "\\'");
      const sName = (a.services?.name || '').replace(/'/g, "\\'");
      const pName = (a.professionals?.name || '').replace(/'/g, "\\'");
      return `
      <div class="appt-card" data-id="${a.id}">
        <div class="appt-time">${formatTime(a.start_time)}</div>
        <div class="appt-info">
          <h4>${a.clients?.full_name || "Sin nombre"}</h4>
          <p>${sName} · ${pName} ${a.clients?.instagram ? "· " + a.clients.instagram : ""}</p>
        </div>
        <div class="appt-actions">
          <span class="appt-status status-${a.status}">${statusLabel(a.status)}</span>
          ${["pending","confirmed"].includes(a.status) ? `<button class="action-btn" onclick="vasca.editAppt('${a.id}','${a.professional_id}','${a.service_id}','${a.appointment_date}','${a.start_time}','${cPhone}','${cName}','${sName}')">Modificar</button>` : ""}
          ${a.status === "confirmed" ? `<button class="action-btn" onclick="vasca.completeAppt('${a.id}')">Completar</button>` : ""}
          ${["pending","confirmed"].includes(a.status) ? `<button class="action-btn danger" onclick="vasca.cancelAppt('${a.id}','${cPhone}','${cName}','${sName}','${a.appointment_date}','${a.start_time}')">Cancelar</button>` : ""}
        </div>
      </div>`;
    }).join("");
  }

  function statusLabel(s) {
    return { pending: "Pendiente", confirmed: "Confirmado", completed: "Completado", cancelled: "Cancelado", no_show: "No vino" }[s] || s;
  }

  // ─── STATUS ACTIONS ────────────────────────────────────
  async function updateStatus(id, status) {
    const body = { status };
    if (status === "confirmed") body.confirmed_at = new Date().toISOString();
    if (status === "cancelled") body.cancelled_at = new Date().toISOString();
    await api("appointments", `id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body) });
    loadDashboard();
    if (document.getElementById("view-calendar").classList.contains("active")) renderCalendar();
  }

  // ─── CALENDAR ──────────────────────────────────────────
  async function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    document.getElementById("cal-month-label").textContent =
      firstDay.toLocaleDateString("es-AR", { month: "long", year: "numeric" });

    // Load month appointments
    const startStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const endStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
    monthAppointments = await api("appointments",
      `select=id,appointment_date,start_time,status,clients(full_name),professionals(name,color),services(name)&appointment_date=gte.${startStr}&appointment_date=lte.${endStr}&status=neq.cancelled&order=start_time`
    );

    const grid = document.getElementById("calendar-grid");
    const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    let html = dayNames.map(d => `<div class="cal-header">${d}</div>`).join("");

    // Pad start (Monday-based)
    let startPad = (firstDay.getDay() + 6) % 7;
    const prevMonth = new Date(year, month, 0);
    for (let i = startPad - 1; i >= 0; i--) {
      const d = prevMonth.getDate() - i;
      html += `<div class="cal-day other-month"><span class="day-num">${d}</span></div>`;
    }

    // Days
    const todayStr = today();
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const count = monthAppointments.filter(a => a.appointment_date === dateStr).length;
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === selectedCalDay;
      html += `<div class="cal-day${isToday ? " today" : ""}${isSelected ? " selected" : ""}" data-date="${dateStr}">
        <span class="day-num">${d}</span>
        ${count ? `<span class="day-count">${count}</span>` : ""}
      </div>`;
    }

    // Pad end
    const endPad = (7 - ((startPad + lastDay.getDate()) % 7)) % 7;
    for (let i = 1; i <= endPad; i++) {
      html += `<div class="cal-day other-month"><span class="day-num">${i}</span></div>`;
    }

    grid.innerHTML = html;

    // Day click
    grid.querySelectorAll(".cal-day:not(.other-month)").forEach(el => {
      el.addEventListener("click", () => {
        selectedCalDay = el.dataset.date;
        renderCalendar();
        showDayDetail(selectedCalDay);
      });
    });

    // Show selected day detail
    if (selectedCalDay) showDayDetail(selectedCalDay);

    // Nav buttons
    document.getElementById("cal-prev").onclick = () => { calendarDate.setMonth(calendarDate.getMonth() - 1); renderCalendar(); };
    document.getElementById("cal-next").onclick = () => { calendarDate.setMonth(calendarDate.getMonth() + 1); renderCalendar(); };
  }

  function showDayDetail(dateStr) {
    const panel = document.getElementById("day-detail-panel");
    const dayAppts = monthAppointments.filter(a => a.appointment_date === dateStr);
    panel.style.display = "block";
    document.getElementById("day-detail-title").textContent = formatDate(dateStr);
    renderAppointmentsList("day-appointments", dayAppts);
  }

  // ─── NEW APPOINTMENT FORM ─────────────────────────────
  function populateFormSelects() {
    const profSelect = document.getElementById("f-professional");
    professionals.forEach(p => {
      profSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });

    const svcSelect = document.getElementById("f-service");
    services.forEach(s => {
      svcSelect.innerHTML += `<option value="${s.id}" data-duration="${s.duration_minutes}">${s.name} (${s.duration_minutes} min)</option>`;
    });

    // Set min date to today
    document.getElementById("f-date").min = today();
  }

  function setupFormListeners() {
    const dateInput = document.getElementById("f-date");
    const profInput = document.getElementById("f-professional");
    const svcInput = document.getElementById("f-service");

    // When date or professional changes, load available slots
    dateInput.addEventListener("change", loadAvailableSlots);
    profInput.addEventListener("change", loadAvailableSlots);
    svcInput.addEventListener("change", loadAvailableSlots);

    // Form submit
    document.getElementById("appointment-form").addEventListener("submit", submitAppointment);
  }

  async function loadAvailableSlots() {
    const timeSelect = document.getElementById("f-time");
    const dateVal = document.getElementById("f-date").value;
    const profVal = document.getElementById("f-professional").value;
    const svcEl = document.getElementById("f-service");
    const svcVal = svcEl.value;

    if (!dateVal || !profVal || !svcVal) {
      timeSelect.innerHTML = `<option value="">Completar campos anteriores</option>`;
      return;
    }

    const duration = parseInt(svcEl.selectedOptions[0].dataset.duration) || 60;
    const dayOfWeek = (new Date(dateVal + "T12:00:00").getDay() + 6) % 7; // Monday=0

    // Get schedule for this day
    const schedule = await api("weekly_schedule",
      `select=*&professional_id=eq.${profVal}&day_of_week=eq.${dayOfWeek + 1}&is_active=eq.true`
    );

    if (!schedule.length) {
      timeSelect.innerHTML = `<option value="">No hay horario este día</option>`;
      return;
    }

    // Get existing appointments for this day
    const existing = await api("appointments",
      `select=start_time,end_time&professional_id=eq.${profVal}&appointment_date=eq.${dateVal}&status=neq.cancelled`
    );

    // Check blocked dates
    const blocked = await api("blocked_dates",
      `select=id&blocked_date=eq.${dateVal}&or=(professional_id.eq.${profVal},professional_id.is.null)`
    );

    if (blocked.length) {
      timeSelect.innerHTML = `<option value="">Día bloqueado</option>`;
      return;
    }

    // Generate slots
    const sched = schedule[0];
    const slots = [];
    const slotInterval = 30; // minutes

    let current = timeToMinutes(sched.start_time);
    const end = timeToMinutes(sched.end_time);
    const breakStart = sched.break_start ? timeToMinutes(sched.break_start) : null;
    const breakEnd = sched.break_end ? timeToMinutes(sched.break_end) : null;

    while (current + duration <= end) {
      const slotEnd = current + duration;

      // Skip break
      if (breakStart !== null && breakEnd !== null) {
        if (current < breakEnd && slotEnd > breakStart) {
          current = breakEnd;
          continue;
        }
      }

      // Check overlap with existing
      const overlap = existing.some(e => {
        const eStart = timeToMinutes(e.start_time);
        const eEnd = timeToMinutes(e.end_time);
        return (current < eEnd && slotEnd > eStart);
      });

      if (!overlap) {
        slots.push(minutesToTime(current));
      }
      current += slotInterval;
    }

    if (!slots.length) {
      timeSelect.innerHTML = `<option value="">Sin horarios disponibles</option>`;
      return;
    }

    timeSelect.innerHTML = `<option value="">Elegir horario</option>` +
      slots.map(s => `<option value="${s}">${s}</option>`).join("");
  }

  function timeToMinutes(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  function minutesToTime(m) {
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  async function submitAppointment(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit");
    const status = document.getElementById("form-status");
    btn.disabled = true;
    status.textContent = "Reservando...";
    status.className = "form-status";

    try {
      const name = document.getElementById("f-name").value.trim();
      const phone = document.getElementById("f-phone").value.trim();
      const ig = document.getElementById("f-ig").value.trim();
      const email = document.getElementById("f-email").value.trim();
      const profId = document.getElementById("f-professional").value;
      const svcId = document.getElementById("f-service").value;
      const date = document.getElementById("f-date").value;
      const time = document.getElementById("f-time").value;
      const notes = document.getElementById("f-notes").value.trim();

      if (!time) throw new Error("Elegí un horario");

      // Get or create client
      let clients = await api("clients", `select=*&phone=eq.${encodeURIComponent(phone)}`);
      let clientId;

      if (clients.length) {
        clientId = clients[0].id;
        // Update name if different
        if (clients[0].full_name !== name) {
          await api("clients", `id=eq.${clientId}`, {
            method: "PATCH",
            body: JSON.stringify({ full_name: name, instagram: ig || null, email: email || null })
          });
        }
      } else {
        const newClient = await api("clients", "", {
          method: "POST",
          body: JSON.stringify({ full_name: name, phone, instagram: ig || null, email: email || null })
        });
        clientId = newClient[0].id;
      }

      // Get price
      const priceData = prices.find(p => p.service_id === svcId && p.professional_id === profId);
      const price = priceData ? priceData.price_ars : 0;

      // Get service duration
      const svc = services.find(s => s.id === svcId);
      const duration = svc ? svc.duration_minutes : 60;
      const endTime = minutesToTime(timeToMinutes(time) + duration);

      // Create appointment
      await api("appointments", "", {
        method: "POST",
        body: JSON.stringify({
          client_id: clientId,
          professional_id: profId,
          service_id: svcId,
          appointment_date: date,
          start_time: time,
          end_time: endTime,
          price_ars: price,
          status: "confirmed",
          client_notes: notes || null,
          confirmed_at: new Date().toISOString()
        })
      });

      status.textContent = "✓ Turno reservado exitosamente";
      status.className = "form-status success";
      document.getElementById("appointment-form").reset();
      document.getElementById("f-time").innerHTML = `<option value="">Elegir fecha primero</option>`;
    } catch (err) {
      status.textContent = "✗ " + (err.message || "Error al reservar");
      status.className = "form-status error";
    } finally {
      btn.disabled = false;
    }
  }

  // ─── CLIENTS ───────────────────────────────────────────
  async function loadClients() {
    const clients = await api("clients", "select=*&order=created_at.desc");
    renderClients(clients);

    document.getElementById("client-search").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = clients.filter(c =>
        c.full_name.toLowerCase().includes(q) || c.phone.includes(q)
      );
      renderClients(filtered);
    });
  }

  function renderClients(clients) {
    const container = document.getElementById("clients-list");
    if (!clients.length) {
      container.innerHTML = `<p class="empty-msg">No hay clientas registradas</p>`;
      return;
    }
    container.innerHTML = clients.map(c => `
      <div class="client-card">
        <h4>${c.full_name}</h4>
        <p>${c.phone}${c.instagram ? " · " + c.instagram : ""}${c.email ? "<br>" + c.email : ""}</p>
        <span class="visits-badge">${c.total_visits} visita${c.total_visits !== 1 ? "s" : ""}</span>
      </div>
    `).join("");
  }

  // ─── WHATSAPP HELPER ───────────────────────────────────
  function sendWhatsApp(phone, message, label) {
    const clean = phone.replace(/\D/g, "");
    const num = clean.startsWith("54") ? clean : "54" + clean;
    const url = `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
    const toast = document.getElementById("wa-toast");
    const toastText = document.getElementById("wa-toast-text");
    const toastLink = document.getElementById("wa-toast-link");
    toastText.textContent = label || "Notificar a la clienta";
    toastLink.href = url;
    toast.style.display = "flex";
    // Auto-hide after 15s
    clearTimeout(window._waToastTimer);
    window._waToastTimer = setTimeout(() => { toast.style.display = "none"; }, 15000);
  }

  function fmtDateNice(d) {
    return new Date(d + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  }

  // ─── EDIT APPOINTMENT MODAL ─────────────────────────────
  let editingAppt = null;

  function openEditModal(id, profId, svcId, date, time, phone, clientName, svcName) {
    editingAppt = { id, profId, svcId, phone, clientName, svcName, oldDate: date, oldTime: formatTime(time) };
    const modal = document.getElementById("edit-modal");
    modal.style.display = "flex";
    document.getElementById("edit-status").textContent = "";

    const svc = services.find(s => s.id === svcId);
    const prof = professionals.find(p => p.id === profId);
    document.getElementById("edit-info").textContent =
      `${svc?.name || svcName} con ${prof?.name || ""} — ${clientName}`;

    document.getElementById("edit-date").value = date;
    document.getElementById("edit-time").value = formatTime(time);
  }

  async function saveEdit() {
    const btn = document.getElementById("btn-edit-save");
    const status = document.getElementById("edit-status");
    const newDate = document.getElementById("edit-date").value;
    const newTime = document.getElementById("edit-time").value;

    if (!newDate || !newTime) { status.textContent = "Completá fecha y hora"; status.className = "form-status error"; return; }

    btn.disabled = true;
    const svc = services.find(s => s.id === editingAppt.svcId);
    const duration = svc ? svc.duration_minutes : 60;
    const endTime = minutesToTime(timeToMinutes(newTime) + duration);

    try {
      const contactPhone = editingAppt.phone;
      const contactName = editingAppt.clientName;
      const contactSvc = editingAppt.svcName;

      await api("appointments", `id=eq.${editingAppt.id}`, {
        method: "PATCH",
        body: JSON.stringify({ appointment_date: newDate, start_time: newTime, end_time: endTime })
      });
      closeEditModal();
      loadDashboard();
      if (document.getElementById("view-calendar").classList.contains("active")) renderCalendar();

      // Notificar por WhatsApp
      if (contactPhone) {
        const msg = `¡Hola ${contactName}! 💫 Te informamos que tu turno de *${contactSvc}* fue modificado.\n\n📅 Nueva fecha: *${fmtDateNice(newDate)}*\n🕐 Nuevo horario: *${newTime} hs*\n\nSi tenés alguna consulta no dudes en escribirnos. ¡Te esperamos! ✨\n\n— Vasca Lashes`;
        sendWhatsApp(contactPhone, msg, `✏️ Turno modificado — ${contactName}`);
      }
    } catch (err) {
      status.textContent = "Error: " + err.message;
      status.className = "form-status error";
    } finally { btn.disabled = false; }
  }

  function closeEditModal() {
    document.getElementById("edit-modal").style.display = "none";
    editingAppt = null;
  }

  // ─── CANCEL WITH NOTIFICATION ──────────────────────────
  async function cancelAppt(id, phone, clientName, svcName, date, time) {
    if (!confirm("¿Cancelar este turno?")) return;
    try {
      await updateStatus(id, "cancelled");
      if (phone) {
        const msg = `Hola ${clientName} 🙁 Lamentamos informarte que tu turno de *${svcName}* del *${fmtDateNice(date)}* a las *${formatTime(time)} hs* fue cancelado.\n\nPodés reservar un nuevo turno en nuestra web cuando quieras.\n\n— Vasca Lashes`;
        sendWhatsApp(phone, msg, `❌ Turno cancelado — ${clientName}`);
      }
    } catch (err) {
      alert("Error al cancelar: " + err.message);
    }
  }

  // ─── REMINDERS ──────────────────────────────────────────
  function sendReminder(apptId, phone, clientName, svcName, date, time) {
    if (!phone) { alert("Esta clienta no tiene teléfono registrado"); return; }
    const msg = `¡Hola ${clientName}! 💫 Te recordamos que mañana tenés turno de *${svcName}*.\n\n🕐 Horario: *${formatTime(time)} hs*\n📍 Alvarado 968\n\nSi necesitás reprogramar avisanos con tiempo. ¡Te esperamos! ✨\n\n— Vasca Lashes`;
    sendWhatsApp(phone, msg, `🔔 Recordatorio — ${clientName}`);

    // Marcar como enviado
    const sent = JSON.parse(localStorage.getItem("vasca_reminders_sent") || "{}");
    sent[apptId] = new Date().toISOString();
    localStorage.setItem("vasca_reminders_sent", JSON.stringify(sent));
    renderReminders();
  }

  function sendAllReminders() {
    const sent = JSON.parse(localStorage.getItem("vasca_reminders_sent") || "{}");
    const pending = tomorrowAppts.filter(a => !sent[a.id] && a.clients?.phone);
    if (!pending.length) { alert("Ya se enviaron todos los recordatorios"); return; }

    if (!confirm(`¿Enviar recordatorio a ${pending.length} clienta(s)?`)) return;

    pending.forEach((a, i) => {
      setTimeout(() => {
        sendReminder(a.id, a.clients.phone, a.clients.full_name || "Clienta", a.services?.name || "", a.appointment_date, a.start_time);
      }, i * 1500);
    });
  }

  // ─── EXPOSE GLOBAL ACTIONS ─────────────────────────────
  window.vasca = {
    editAppt: openEditModal,
    completeAppt: (id) => updateStatus(id, "completed"),
    cancelAppt,
    saveEdit,
    closeModal: closeEditModal,
    sendReminder,
    sendAllReminders
  };

  // ─── GO ────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", init);
})();
