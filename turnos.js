/* ═══════════════════════════════════════════════════
   VASCA — Panel de Turnos (Clientas)
   ═══════════════════════════════════════════════════ */
(function () {
  "use strict";

  const SUPABASE_URL = "https://mxoztaxlcciqrdejfpum.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14b3p0YXhsY2NpcXJkZWpmcHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MTQ3NzksImV4cCI6MjA5NDE5MDc3OX0.bwE9e5P2UvqAC9VauZVk1q6j19mnDkAptXMOTEiKhJA";

  // ─── AUTH CHECK ──────────────────────────────────
  const userToken = localStorage.getItem("vasca_token");
  if (!userToken) {
    window.location.href = "login.html";
    return;
  }

  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${userToken}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };

  // ─── LOGOUT ──────────────────────────────────────
  window.logoutClient = function () {
    localStorage.removeItem("vasca_token");
    localStorage.removeItem("vasca_refresh");
    localStorage.removeItem("vasca_user");
    localStorage.removeItem("vasca_role");
    window.location.href = "login.html";
  };

  let professionals = [];
  let services = [];
  let prices = [];
  let selected = { service: null, professional: null, date: null, time: null };

  async function api(table, query = "", opts = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${table}${query ? "?" + query : ""}`;
    const res = await fetch(url, { headers: { ...headers, ...opts.headers }, method: opts.method || "GET", body: opts.body });
    if (!res.ok) throw new Error(await res.text());
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function today() { return new Date().toISOString().split("T")[0]; }
  function timeToMin(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
  function minToTime(m) { return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }

  function show(id) { document.getElementById(id).classList.remove("hidden"); document.getElementById(id).scrollIntoView({ behavior: "smooth", block: "start" }); }
  function hide(id) { document.getElementById(id).classList.add("hidden"); }

  // ─── INIT ──────────────────────────────────────
  async function init() {
    // Skeleton while loading
    document.getElementById("services-list").innerHTML =
      '<div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>';

    [professionals, services, prices] = await Promise.all([
      api("professionals", "select=*&is_active=eq.true&order=sort_order"),
      api("services", "select=*&is_active=eq.true&order=sort_order"),
      api("service_professional_prices", "select=*&is_active=eq.true")
    ]);
    renderServices();
    document.getElementById("book-date").min = today();
    document.getElementById("book-date").addEventListener("change", loadSlots);
  }

  // ─── STEP 1: SERVICES ─────────────────────────
  function renderServices() {
    const container = document.getElementById("services-list");
    container.innerHTML = services.map(s => {
      const svcPrices = prices.filter(p => p.service_id === s.id);
      const minPrice = Math.min(...svcPrices.map(p => p.price_ars));
      return `<div class="svc-card" data-id="${s.id}" onclick="vasca.selectService('${s.id}')">
        <h3>${s.name}</h3>
        <p class="svc-meta">${s.duration_minutes} min · ${s.description || ""}</p>
        <div class="svc-price">Desde $${minPrice.toLocaleString("es-AR")}</div>
      </div>`;
    }).join("");
  }

  function selectService(id) {
    selected.service = services.find(s => s.id === id);
    selected.professional = null;
    selected.date = null;
    selected.time = null;
    document.querySelectorAll(".svc-card").forEach(c => c.classList.toggle("selected", c.dataset.id === id));
    hide("step-datetime"); hide("step-info"); hide("step-confirm");
    renderProfessionals();
    show("step-professional");
  }

  // ─── STEP 2: PROFESSIONALS ────────────────────
  function renderProfessionals() {
    const container = document.getElementById("professionals-list");
    container.innerHTML = professionals.map(p => {
      const price = prices.find(pr => pr.professional_id === p.id && pr.service_id === selected.service.id);
      return `<div class="prof-card" data-id="${p.id}" onclick="vasca.selectProfessional('${p.id}')">
        <div class="prof-avatar" style="background:${p.color}">${p.name.charAt(0)}</div>
        <h3>${p.name}</h3>
        <div class="prof-price">$${price ? price.price_ars.toLocaleString("es-AR") : "—"}</div>
      </div>`;
    }).join("");
  }

  function selectProfessional(id) {
    selected.professional = professionals.find(p => p.id === id);
    selected.date = null;
    selected.time = null;
    document.querySelectorAll(".prof-card").forEach(c => c.classList.toggle("selected", c.dataset.id === id));
    hide("step-info"); hide("step-confirm");
    document.getElementById("book-date").value = "";
    document.getElementById("time-slots").innerHTML = `<p class="hint">Elegí una fecha para ver horarios</p>`;
    show("step-datetime");
  }

  // ─── STEP 3: DATE & TIME ──────────────────────
  async function loadSlots() {
    const dateVal = document.getElementById("book-date").value;
    const slotsContainer = document.getElementById("time-slots");
    selected.date = dateVal;
    selected.time = null;

    if (!dateVal || !selected.professional || !selected.service) {
      slotsContainer.innerHTML = `<p class="hint">Completá los pasos anteriores</p>`;
      return;
    }

    slotsContainer.innerHTML = `<p class="hint">Cargando...</p>`;

    const dayOfWeek = (new Date(dateVal + "T12:00:00").getDay() + 6) % 7;
    const [schedule, existing, blocked] = await Promise.all([
      api("weekly_schedule", `select=*&professional_id=eq.${selected.professional.id}&day_of_week=eq.${dayOfWeek + 1}&is_active=eq.true`),
      api("appointments", `select=start_time,end_time&professional_id=eq.${selected.professional.id}&appointment_date=eq.${dateVal}&status=neq.cancelled`),
      api("blocked_dates", `select=id&blocked_date=eq.${dateVal}&or=(professional_id.eq.${selected.professional.id},professional_id.is.null)`)
    ]);

    if (blocked.length) { slotsContainer.innerHTML = `<p class="hint">Este día no está disponible</p>`; return; }
    if (!schedule.length) { slotsContainer.innerHTML = `<p class="hint">${selected.professional.name} no trabaja este día</p>`; return; }

    const sched = schedule[0];
    const duration = selected.service.duration_minutes;
    const slots = [];
    let cur = timeToMin(sched.start_time);
    const end = timeToMin(sched.end_time);
    const bStart = sched.break_start ? timeToMin(sched.break_start) : null;
    const bEnd = sched.break_end ? timeToMin(sched.break_end) : null;

    while (cur + duration <= end) {
      const slotEnd = cur + duration;
      if (bStart !== null && bEnd !== null && cur < bEnd && slotEnd > bStart) { cur = bEnd; continue; }
      const overlap = existing.some(e => cur < timeToMin(e.end_time) && slotEnd > timeToMin(e.start_time));
      if (!overlap) slots.push(minToTime(cur));
      cur += 30;
    }

    if (!slots.length) { slotsContainer.innerHTML = `<p class="hint">No hay horarios disponibles</p>`; return; }

    slotsContainer.innerHTML = slots.map(s =>
      `<button class="slot-btn" onclick="vasca.selectTime('${s}')">${s}</button>`
    ).join("");
  }

  function selectTime(time) {
    selected.time = time;
    document.querySelectorAll(".slot-btn").forEach(b => b.classList.toggle("selected", b.textContent === time));
    show("step-info");

    // Listen for info form changes to show summary
    ["book-name", "book-phone"].forEach(id => {
      document.getElementById(id).addEventListener("input", checkShowSummary);
    });
    checkShowSummary();
  }

  function checkShowSummary() {
    const name = document.getElementById("book-name").value.trim();
    const phone = document.getElementById("book-phone").value.trim();
    if (name && phone) {
      renderSummary();
      show("step-confirm");
    } else {
      hide("step-confirm");
    }
  }

  // ─── STEP 5: SUMMARY ─────────────────────────
  function renderSummary() {
    const price = prices.find(p => p.professional_id === selected.professional.id && p.service_id === selected.service.id);
    const dateFormatted = new Date(selected.date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
    const endTime = minToTime(timeToMin(selected.time) + selected.service.duration_minutes);

    document.getElementById("summary-details").innerHTML = `
      <div class="summary-row"><span>Servicio</span><span>${selected.service.name}</span></div>
      <div class="summary-row"><span>Profesional</span><span>${selected.professional.name}</span></div>
      <div class="summary-row"><span>Fecha</span><span>${dateFormatted}</span></div>
      <div class="summary-row"><span>Horario</span><span>${selected.time} – ${endTime}</span></div>
      <div class="summary-row"><span>Total</span><span>$${price ? price.price_ars.toLocaleString("es-AR") : "—"}</span></div>
    `;
  }

  // ─── CONFIRM ──────────────────────────────────
  async function confirmBooking() {
    const btn = document.getElementById("btn-confirm");
    const status = document.getElementById("booking-status");
    btn.disabled = true;
    status.textContent = "";

    try {
      const name = document.getElementById("book-name").value.trim();
      const phone = document.getElementById("book-phone").value.trim();
      const ig = document.getElementById("book-ig").value.trim();
      const email = document.getElementById("book-email").value.trim();
      const notes = document.getElementById("book-notes").value.trim();

      // ── Duplicate check ──
      let clients = await api("clients", `select=*&phone=eq.${encodeURIComponent(phone)}`);
      let clientId;
      if (clients.length) {
        clientId = clients[0].id;
        // Check for existing appointment same day
        const existing = await api("appointments", `select=id&client_id=eq.${clientId}&appointment_date=eq.${selected.date}&status=neq.cancelled`);
        if (existing.length) {
          status.textContent = "Ya tenés un turno reservado para esa fecha.";
          status.className = "form-status error";
          btn.disabled = false;
          return;
        }
        await api("clients", `id=eq.${clientId}`, { method: "PATCH", body: JSON.stringify({ full_name: name, instagram: ig || null, email: email || null }) });
      } else {
        const nc = await api("clients", "", { method: "POST", body: JSON.stringify({ full_name: name, phone, instagram: ig || null, email: email || null }) });
        clientId = nc[0].id;
      }

      const price = prices.find(p => p.professional_id === selected.professional.id && p.service_id === selected.service.id);
      const endTime = minToTime(timeToMin(selected.time) + selected.service.duration_minutes);

      await api("appointments", "", {
        method: "POST",
        body: JSON.stringify({
          client_id: clientId,
          professional_id: selected.professional.id,
          service_id: selected.service.id,
          appointment_date: selected.date,
          start_time: selected.time,
          end_time: endTime,
          price_ars: price ? price.price_ars : 0,
          status: "pending",
          client_notes: notes || null
        })
      });

      // Show success + Google Calendar link
      const dateF = new Date(selected.date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
      document.getElementById("success-msg").textContent = `${selected.service.name} con ${selected.professional.name} · ${dateF} a las ${selected.time}`;

      // Google Calendar link
      const calStart = selected.date.replace(/-/g, "") + "T" + selected.time.replace(":", "") + "00";
      const calEnd = selected.date.replace(/-/g, "") + "T" + endTime.replace(":", "") + "00";
      const calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(selected.service.name + " - Vasca Lashes")}&dates=${calStart}/${calEnd}&location=${encodeURIComponent("Alvarado 968")}&details=${encodeURIComponent("Turno con " + selected.professional.name)}`;
      document.getElementById("cal-link").href = calUrl;

      hide("step-service"); hide("step-professional"); hide("step-datetime"); hide("step-info"); hide("step-confirm");
      show("step-success");
    } catch (err) {
      status.textContent = "Error: " + (err.message || "No se pudo reservar");
      status.className = "form-status error";
      btn.disabled = false;
    }
  }

  // ─── TAB SWITCHING ─────────────────────────────
  window.switchTab = function (tab) {
    const steps = ["step-service", "step-professional", "step-datetime", "step-info", "step-confirm", "step-success"];
    const myView = document.getElementById("view-my-appointments");

    document.getElementById("tab-new").classList.toggle("active", tab === "new");
    document.getElementById("tab-mine").classList.toggle("active", tab === "mine");

    if (tab === "new") {
      myView.style.display = "none";
      document.getElementById("step-service").classList.remove("hidden");
    } else {
      steps.forEach(s => hide(s));
      myView.style.display = "block";
      loadMyAppointments();
    }
  };

  // ─── MY APPOINTMENTS ──────────────────────────
  async function loadMyAppointments() {
    const container = document.getElementById("my-appts-list");
    container.innerHTML = '<div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>';

    try {
      // Get user email from token
      const payload = JSON.parse(atob(userToken.split(".")[1]));
      const userEmail = payload.email;
      if (!userEmail) { container.innerHTML = '<p class="hint">No se pudo identificar tu cuenta</p>'; return; }

      // Find client by email
      const clientData = await api("clients", `select=id&email=eq.${encodeURIComponent(userEmail)}`);
      if (!clientData.length) {
        container.innerHTML = '<p class="hint">No tenés turnos registrados todavía. ¡Reservá tu primer turno!</p>';
        return;
      }

      const appts = await api("appointments",
        `select=*,services(name),professionals(name)&client_id=eq.${clientData[0].id}&order=appointment_date.desc,start_time.desc&limit=20`
      );

      if (!appts.length) {
        container.innerHTML = '<p class="hint">No tenés turnos todavía. ¡Reservá tu primer turno!</p>';
        return;
      }

      const statusLabel = { pending: "Pendiente", confirmed: "Confirmado", completed: "Completado", cancelled: "Cancelado" };

      container.innerHTML = appts.map(a => {
        const dateF = new Date(a.appointment_date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
        const time = a.start_time.substring(0, 5);
        const canCancel = ["pending", "confirmed"].includes(a.status);
        return `<div class="my-appt-card">
          <div class="my-appt-info">
            <h4>${a.services?.name || "Servicio"}</h4>
            <p>${dateF} · ${time} hs · ${a.professionals?.name || ""}</p>
          </div>
          <div class="my-appt-actions">
            <span class="my-appt-status ${a.status}">${statusLabel[a.status] || a.status}</span>
            ${canCancel ? `<button class="my-appt-cancel" onclick="vasca.cancelMyAppt('${a.id}')">Cancelar</button>` : ""}
          </div>
        </div>`;
      }).join("");
    } catch (err) {
      container.innerHTML = `<p class="hint">Error al cargar turnos: ${err.message}</p>`;
    }
  }

  async function cancelMyAppt(id) {
    if (!confirm("¿Segura que querés cancelar este turno?")) return;
    try {
      await api("appointments", `id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled", cancelled_at: new Date().toISOString() })
      });
      loadMyAppointments();
    } catch (err) {
      alert("Error al cancelar: " + err.message);
    }
  }

  // ─── EXPOSE ───────────────────────────────────
  window.vasca = { selectService, selectProfessional, selectTime, cancelMyAppt };
  window.confirmBooking = confirmBooking;

  document.addEventListener("DOMContentLoaded", init);
})();
