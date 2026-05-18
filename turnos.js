/* ============================================================
   VASCA - Panel de Turnos para Clientas
   ============================================================ */
(function () {
  "use strict";

  const SUPABASE_URL = "https://mxoztaxlcciqrdejfpum.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14b3p0YXhsY2NpcXJkZWpmcHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MTQ3NzksImV4cCI6MjA5NDE5MDc3OX0.bwE9e5P2UvqAC9VauZVk1q6j19mnDkAptXMOTEiKhJA";
  const userToken = localStorage.getItem("vasca_token");

  if (!userToken) {
    window.location.href = "login.html";
    return;
  }

  const userPayload = parseJwt(userToken);
  const userId = userPayload?.sub || "";
  const userEmail = userPayload?.email || "";

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${userToken}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  let professionals = [];
  let services = [];
  let prices = [];
  let clientRecord = null;
  let profileRecord = null;
  let reviewsByAppointment = new Map();
  let activeReviewAppointment = null;
  let reviewRating = 0;
  let selected = { service: null, professional: null, date: null, time: null };

  async function api(table, query = "", opts = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${table}${query ? "?" + query : ""}`;
    const response = await fetch(url, {
      headers: { ...headers, ...(opts.headers || {}) },
      method: opts.method || "GET",
      body: opts.body,
    });

    if (!response.ok) throw new Error(await response.text());

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function parseJwt(token) {
    try {
      return JSON.parse(atob(token.split(".")[1]));
    } catch {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function today() {
    return new Date().toISOString().split("T")[0];
  }

  function timeToMin(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function minToTime(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function formatDate(date) {
    return new Date(`${date}T12:00:00`).toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  function show(id) {
    const element = document.getElementById(id);
    if (!element) return;
    element.classList.remove("hidden");
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function hide(id) {
    const element = document.getElementById(id);
    if (element) element.classList.add("hidden");
  }

  function prefillClientFields() {
    if (!clientRecord) return;

    const map = {
      "book-name": clientRecord.full_name || profileRecord?.full_name || "",
      "book-phone": clientRecord.phone || profileRecord?.phone || "",
      "book-email": clientRecord.email || userEmail || "",
      "book-ig": clientRecord.instagram || "",
    };

    Object.entries(map).forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (field && !field.value && value) field.value = value;
    });
  }

  async function bootstrapIdentity(seed = {}) {
    if (!userId) throw new Error("No pudimos identificar tu cuenta.");

    if (!profileRecord) {
      const profiles = await api("profiles", `select=id,full_name,phone,role&id=eq.${userId}&limit=1`);
      profileRecord = profiles?.[0] || null;
    }

    const desired = {
      full_name: seed.full_name || profileRecord?.full_name || "",
      phone: seed.phone || profileRecord?.phone || "",
      email: seed.email || userEmail || "",
      instagram: seed.instagram || null,
      auth_user_id: userId,
    };

    let client = clientRecord;

    if (!client) {
      const byAuth = await api("clients", `select=*&auth_user_id=eq.${userId}&limit=1`).catch(() => []);
      client = byAuth?.[0] || null;
    }

    if (!client && desired.email) {
      const byEmail = await api("clients", `select=*&email=eq.${encodeURIComponent(desired.email)}&order=created_at.asc&limit=1`);
      client = byEmail?.[0] || null;
    }

    if (client) {
      const patch = {};
      if (client.auth_user_id !== userId) patch.auth_user_id = userId;
      if (desired.full_name && desired.full_name !== client.full_name) patch.full_name = desired.full_name;
      if (desired.phone && desired.phone !== client.phone) patch.phone = desired.phone;
      if (desired.email && desired.email !== client.email) patch.email = desired.email;
      if (desired.instagram !== undefined && desired.instagram !== client.instagram) patch.instagram = desired.instagram;

      if (Object.keys(patch).length) {
        let updated;
        try {
          updated = await api("clients", `id=eq.${client.id}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
          });
        } catch {
          const fallbackPatch = { ...patch };
          delete fallbackPatch.auth_user_id;
          updated = Object.keys(fallbackPatch).length
            ? await api("clients", `id=eq.${client.id}`, {
                method: "PATCH",
                body: JSON.stringify(fallbackPatch),
              })
            : [client];
        }
        client = updated?.[0] || { ...client, ...patch };
      }
    } else {
      const payload = {
        full_name: desired.full_name || "Clienta Vasca",
        phone: desired.phone || "Sin teléfono",
        email: desired.email || null,
        instagram: desired.instagram || null,
        auth_user_id: desired.auth_user_id,
      };

      let created;
      try {
        created = await api("clients", "", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } catch {
        const legacyPayload = { ...payload };
        delete legacyPayload.auth_user_id;
        created = await api("clients", "", {
          method: "POST",
          body: JSON.stringify(legacyPayload),
        });
      }

      client = created?.[0] || null;
    }

    clientRecord = client;
    prefillClientFields();
    return clientRecord;
  }

  async function loadLoyaltySummary() {
    try {
      const client = await bootstrapIdentity();
      const rows = await api("v_client_loyalty_summary", `select=*&client_id=eq.${client.id}&limit=1`);
      renderLoyaltySummary(rows?.[0] || null);
    } catch {
      renderLoyaltySummary(null);
    }
  }

  function renderLoyaltySummary(summary) {
    const defaults = {
      points_balance: 0,
      reward_threshold: 100,
      reward_label: "$5.000 de descuento",
      points_to_next_reward: 100,
      progress_pct: 0,
      rewards_available: 0,
    };

    const data = summary || defaults;
    const progress = Math.max(0, Math.min(100, Number(data.progress_pct) || 0));
    const balance = Number(data.points_balance) || 0;
    const remaining = Number(data.points_to_next_reward);
    const rewardsAvailable = Number(data.rewards_available) || 0;

    document.getElementById("loyalty-balance").textContent = balance.toLocaleString("es-AR");
    document.getElementById("loyalty-reward-label").textContent = data.reward_label || defaults.reward_label;
    document.getElementById("loyalty-progress-label").textContent = `${progress}%`;
    document.getElementById("loyalty-progress-bar").style.width = `${progress}%`;

    const remainingText = rewardsAvailable > 0
      ? `Ya tenés ${rewardsAvailable} beneficio${rewardsAvailable > 1 ? "s" : ""} disponible${rewardsAvailable > 1 ? "s" : ""}.`
      : `Te faltan ${remaining || defaults.reward_threshold} puntos para desbloquear tu próximo beneficio.`;

    document.getElementById("loyalty-remaining").textContent = remainingText;
  }

  async function invokeAppointmentEmail(appointmentId) {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/appointment-email`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ appointmentId, type: "created" }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "No se pudo enviar el email");
    }
    return payload;
  }

  function renderServices() {
    const container = document.getElementById("services-list");
    container.innerHTML = services.map((service) => {
      const servicePrices = prices.filter((price) => price.service_id === service.id);
      const minPrice = Math.min(...servicePrices.map((price) => price.price_ars));
      return `<div class="svc-card" data-id="${service.id}" onclick="vasca.selectService('${service.id}')">
        <h3>${escapeHtml(service.name)}</h3>
        <p class="svc-meta">${service.duration_minutes} min · ${escapeHtml(service.description || "")}</p>
        <div class="svc-price">Desde $${Number.isFinite(minPrice) ? minPrice.toLocaleString("es-AR") : "—"}</div>
      </div>`;
    }).join("");
  }

  function renderProfessionals() {
    const container = document.getElementById("professionals-list");
    container.innerHTML = professionals.map((professional) => {
      const price = prices.find((row) => row.professional_id === professional.id && row.service_id === selected.service.id);
      return `<div class="prof-card" data-id="${professional.id}" onclick="vasca.selectProfessional('${professional.id}')">
        <div class="prof-avatar" style="background:${escapeHtml(professional.color || "#8f7769")}">${escapeHtml(professional.name.charAt(0))}</div>
        <h3>${escapeHtml(professional.name)}</h3>
        <div class="prof-price">$${price ? Number(price.price_ars).toLocaleString("es-AR") : "—"}</div>
      </div>`;
    }).join("");
  }

  function selectService(id) {
    selected.service = services.find((service) => service.id === id);
    selected.professional = null;
    selected.date = null;
    selected.time = null;
    document.querySelectorAll(".svc-card").forEach((card) => card.classList.toggle("selected", card.dataset.id === id));
    hide("step-datetime");
    hide("step-info");
    hide("step-confirm");
    renderProfessionals();
    show("step-professional");
  }

  function selectProfessional(id) {
    selected.professional = professionals.find((professional) => professional.id === id);
    selected.date = null;
    selected.time = null;
    document.querySelectorAll(".prof-card").forEach((card) => card.classList.toggle("selected", card.dataset.id === id));
    hide("step-info");
    hide("step-confirm");
    document.getElementById("book-date").value = "";
    if (typeof renderCalendar === "function") renderCalendar();
    document.getElementById("time-slots").innerHTML = "<p class='hint'>Elegí una fecha para ver horarios</p>";
    show("step-datetime");
  }

  async function loadSlots() {
    const dateValue = document.getElementById("book-date").value;
    const slotsContainer = document.getElementById("time-slots");
    selected.date = dateValue;
    selected.time = null;

    if (!dateValue || !selected.professional || !selected.service) {
      slotsContainer.innerHTML = "<p class='hint'>Completá los pasos anteriores</p>";
      return;
    }

    slotsContainer.innerHTML = "<p class='hint'>Cargando...</p>";

    const dayOfWeek = (new Date(`${dateValue}T12:00:00`).getDay() + 6) % 7;
    const [schedule, existing, blocked] = await Promise.all([
      api("weekly_schedule", `select=*&professional_id=eq.${selected.professional.id}&day_of_week=eq.${dayOfWeek + 1}&is_active=eq.true`),
      api("appointments", `select=start_time,end_time&professional_id=eq.${selected.professional.id}&appointment_date=eq.${dateValue}&status=neq.cancelled`),
      api("blocked_dates", `select=id&blocked_date=eq.${dateValue}&or=(professional_id.eq.${selected.professional.id},professional_id.is.null)`),
    ]);

    if (blocked.length) {
      slotsContainer.innerHTML = "<p class='hint'>Este día no está disponible</p>";
      return;
    }

    if (!schedule.length) {
      slotsContainer.innerHTML = `<p class='hint'>${escapeHtml(selected.professional.name)} no trabaja este día</p>`;
      return;
    }

    const sched = schedule[0];
    const duration = selected.service.duration_minutes;
    const slots = [];
    let current = timeToMin(sched.start_time);
    const end = timeToMin(sched.end_time);
    const breakStart = sched.break_start ? timeToMin(sched.break_start) : null;
    const breakEnd = sched.break_end ? timeToMin(sched.break_end) : null;

    while (current + duration <= end) {
      const slotEnd = current + duration;

      if (breakStart !== null && breakEnd !== null && current < breakEnd && slotEnd > breakStart) {
        current = breakEnd;
        continue;
      }

      const overlap = existing.some((appointment) => current < timeToMin(appointment.end_time) && slotEnd > timeToMin(appointment.start_time));
      if (!overlap) slots.push(minToTime(current));
      current += 30;
    }

    if (!slots.length) {
      slotsContainer.innerHTML = "<p class='hint'>No hay horarios disponibles</p>";
      return;
    }

    slotsContainer.innerHTML = slots.map((slot) => `<button class="slot-btn" onclick="vasca.selectTime('${slot}')">${slot}</button>`).join("");
  }

  function selectTime(time) {
    selected.time = time;
    document.querySelectorAll(".slot-btn").forEach((button) => button.classList.toggle("selected", button.textContent === time));
    show("step-info");
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

  function renderSummary() {
    const price = prices.find((row) => row.professional_id === selected.professional.id && row.service_id === selected.service.id);
    const endTime = minToTime(timeToMin(selected.time) + selected.service.duration_minutes);

    document.getElementById("summary-details").innerHTML = `
      <div class="summary-row"><span>Servicio</span><span>${escapeHtml(selected.service.name)}</span></div>
      <div class="summary-row"><span>Profesional</span><span>${escapeHtml(selected.professional.name)}</span></div>
      <div class="summary-row"><span>Fecha</span><span>${escapeHtml(formatDate(selected.date))}</span></div>
      <div class="summary-row"><span>Horario</span><span>${selected.time} – ${endTime}</span></div>
      <div class="summary-row"><span>Total</span><span>$${price ? Number(price.price_ars).toLocaleString("es-AR") : "—"}</span></div>
    `;
  }

  async function confirmBooking() {
    const button = document.getElementById("btn-confirm");
    const status = document.getElementById("booking-status");
    button.disabled = true;
    status.textContent = "";
    status.className = "form-status";

    try {
      const fullName = document.getElementById("book-name").value.trim();
      const phone = document.getElementById("book-phone").value.trim();
      const instagram = document.getElementById("book-ig").value.trim();
      const email = document.getElementById("book-email").value.trim() || userEmail;
      const notes = document.getElementById("book-notes").value.trim();

      const client = await bootstrapIdentity({
        full_name: fullName,
        phone,
        email,
        instagram: instagram || null,
      });

      const existing = await api("appointments", `select=id&client_id=eq.${client.id}&appointment_date=eq.${selected.date}&status=neq.cancelled&limit=1`);
      if (existing.length) {
        status.textContent = "Ya tenés un turno reservado para esa fecha.";
        status.className = "form-status error";
        button.disabled = false;
        return;
      }

      const price = prices.find((row) => row.professional_id === selected.professional.id && row.service_id === selected.service.id);
      const endTime = minToTime(timeToMin(selected.time) + selected.service.duration_minutes);

      const created = await api("appointments", "", {
        method: "POST",
        body: JSON.stringify({
          client_id: client.id,
          professional_id: selected.professional.id,
          service_id: selected.service.id,
          appointment_date: selected.date,
          start_time: selected.time,
          end_time: endTime,
          price_ars: price ? price.price_ars : 0,
          status: "pending",
          client_notes: notes || null,
        }),
      });

      const appointment = created?.[0];
      let emailNotice = "Tu confirmación quedó guardada y ya podés sumarla al calendario.";

      if (appointment?.id && email) {
        try {
          await invokeAppointmentEmail(appointment.id);
          emailNotice = `También enviamos la confirmación a ${email}.`;
        } catch {
          emailNotice = "Guardamos tu turno, pero el email quedó pendiente. Igual podés verlo desde tu panel.";
        }
      }

      const dateLabel = formatDate(selected.date);
      document.getElementById("success-msg").textContent = `${selected.service.name} con ${selected.professional.name} · ${dateLabel} a las ${selected.time}`;
      document.getElementById("success-email-note").textContent = emailNotice;

      const calStart = `${selected.date.replace(/-/g, "")}T${selected.time.replace(":", "")}00`;
      const calEnd = `${selected.date.replace(/-/g, "")}T${endTime.replace(":", "")}00`;
      const calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${selected.service.name} - Vasca Lashes`)}&dates=${calStart}/${calEnd}&location=${encodeURIComponent("Alvarado 968")}&details=${encodeURIComponent(`Turno con ${selected.professional.name}`)}`;
      document.getElementById("cal-link").href = calUrl;

      hide("step-service");
      hide("step-professional");
      hide("step-datetime");
      hide("step-info");
      hide("step-confirm");
      show("step-success");
      button.disabled = false;
      status.textContent = "";

      await Promise.allSettled([loadMyAppointments(), loadLoyaltySummary()]);
    } catch (error) {
      status.textContent = `Error: ${error.message || "No se pudo reservar"}`;
      status.className = "form-status error";
      button.disabled = false;
    }
  }

  function statusLabel(status) {
    return {
      pending: "Pendiente",
      confirmed: "Confirmado",
      completed: "Completado",
      cancelled: "Cancelado",
    }[status] || status;
  }

  function reviewChip(review) {
    if (!review) return "";
    if (review.is_published) return "<span class='my-chip review published'>Reseña publicada</span>";
    if (review.is_approved) return "<span class='my-chip review'>Reseña aprobada</span>";
    return "<span class='my-chip review pending-review'>Reseña en moderación</span>";
  }

  function renderReviewPreview(review) {
    if (!review) return "";
    return `
      <div class="my-review-preview">
        <div class="my-review-stars">${"★".repeat(Number(review.rating) || 5)}</div>
        <p>${escapeHtml(review.comment)}</p>
      </div>
    `;
  }

  async function loadMyAppointments() {
    const container = document.getElementById("my-appts-list");
    container.innerHTML = "<div class='skeleton skeleton-card'></div><div class='skeleton skeleton-card'></div><div class='skeleton skeleton-card'></div>";

    try {
      const client = await bootstrapIdentity();
      if (!client?.id) {
        container.innerHTML = "<p class='hint'>No pudimos identificar tu cuenta.</p>";
        return;
      }

      const appointments = await api("appointments", `select=*,services(name),professionals(name)&client_id=eq.${client.id}&order=appointment_date.desc,start_time.desc&limit=20`);
      const reviews = await api("reviews", `select=id,appointment_id,rating,comment,is_approved,is_published,created_at&client_id=eq.${client.id}&order=created_at.desc`).catch(() => []);

      reviewsByAppointment = new Map((reviews || []).map((review) => [review.appointment_id, review]));

      if (!appointments.length) {
        container.innerHTML = "<p class='hint'>No tenés turnos registrados todavía. ¡Reservá tu primer turno!</p>";
        return;
      }

      container.innerHTML = appointments.map((appointment) => {
        const review = reviewsByAppointment.get(appointment.id);
        const canCancel = ["pending", "confirmed"].includes(appointment.status);
        const canReview = appointment.status === "completed" && !review;
        const dateLabel = new Date(`${appointment.appointment_date}T12:00:00`).toLocaleDateString("es-AR", {
          weekday: "short",
          day: "numeric",
          month: "short",
        });
        const timeLabel = appointment.start_time.substring(0, 5);
        const reviewButton = canReview
          ? `<button class="my-appt-btn review" onclick="vasca.openReviewModal('${appointment.id}')">Dejar reseña</button>`
          : "";
        const cancelButton = canCancel
          ? `<button class="my-appt-btn cancel" onclick="vasca.cancelMyAppt('${appointment.id}')">Cancelar turno</button>`
          : "";

        return `
          <article class="my-appt-card">
            <div class="my-appt-info">
              <h4>${escapeHtml(appointment.services?.name || "Servicio")}</h4>
              <p>${escapeHtml(dateLabel)} · ${timeLabel} hs · ${escapeHtml(appointment.professionals?.name || "")}</p>
              <div class="my-appt-meta">
                <span class="my-chip">${escapeHtml(statusLabel(appointment.status))}</span>
                ${reviewChip(review)}
              </div>
              ${renderReviewPreview(review)}
            </div>
            <div class="my-appt-actions">
              <span class="my-appt-status ${escapeHtml(appointment.status)}">${escapeHtml(statusLabel(appointment.status))}</span>
              ${reviewButton}
              ${cancelButton}
            </div>
          </article>
        `;
      }).join("");
    } catch (error) {
      container.innerHTML = `<p class="hint">Error al cargar turnos: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function cancelMyAppt(id) {
    if (!confirm("¿Segura que querés cancelar este turno?")) return;

    try {
      await api("appointments", `id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled", cancelled_at: new Date().toISOString() }),
      });
      await loadMyAppointments();
    } catch (error) {
      alert(`Error al cancelar: ${error.message}`);
    }
  }

  function switchTab(tab) {
    const steps = ["step-service", "step-professional", "step-datetime", "step-info", "step-confirm", "step-success"];
    const myView = document.getElementById("view-my-appointments");

    document.getElementById("tab-new").classList.toggle("active", tab === "new");
    document.getElementById("tab-mine").classList.toggle("active", tab === "mine");

    if (tab === "new") {
      steps.forEach((step) => hide(step));
      myView.style.display = "none";
      document.getElementById("step-service").classList.remove("hidden");
      document.getElementById("btn-confirm").disabled = false;
      document.getElementById("booking-status").textContent = "";
      return;
    }

    steps.forEach((step) => hide(step));
    myView.style.display = "block";
    loadMyAppointments();
    loadLoyaltySummary();
  }

  function openReviewModal(appointmentId) {
    activeReviewAppointment = appointmentId;
    reviewRating = 0;
    document.getElementById("review-comment").value = "";
    document.getElementById("review-status").textContent = "";
    document.querySelectorAll(".review-star").forEach((button) => button.classList.remove("active"));

    const title = document.getElementById("review-modal-title");
    const serviceName = document.querySelector(`[onclick="vasca.openReviewModal('${appointmentId}')"]`)?.closest(".my-appt-card")?.querySelector("h4")?.textContent || "tu experiencia";
    title.textContent = `Contanos cómo fue ${serviceName}`;

    document.getElementById("review-modal").classList.add("open");
  }

  function closeReviewModal() {
    activeReviewAppointment = null;
    reviewRating = 0;
    document.getElementById("review-modal").classList.remove("open");
  }

  function setReviewRating(value) {
    reviewRating = value;
    document.querySelectorAll(".review-star").forEach((button) => {
      const starValue = Number(button.dataset.value);
      button.classList.toggle("active", starValue <= value);
    });
  }

  async function submitReview() {
    const status = document.getElementById("review-status");
    const button = document.getElementById("review-submit");
    const comment = document.getElementById("review-comment").value.trim();

    if (!activeReviewAppointment) {
      status.textContent = "No pudimos identificar el turno a reseñar.";
      status.className = "form-status error";
      return;
    }

    if (!reviewRating) {
      status.textContent = "Elegí una puntuación de 1 a 5 estrellas.";
      status.className = "form-status error";
      return;
    }

    if (comment.length < 10) {
      status.textContent = "Escribí al menos 10 caracteres para enviar tu reseña.";
      status.className = "form-status error";
      return;
    }

    button.disabled = true;
    status.textContent = "Enviando reseña...";
    status.className = "form-status";

    try {
      const client = await bootstrapIdentity();
      await api("reviews", "", {
        method: "POST",
        body: JSON.stringify({
          appointment_id: activeReviewAppointment,
          client_id: client.id,
          rating: reviewRating,
          comment,
        }),
      });

      status.textContent = "¡Gracias! Tu reseña quedó enviada para moderación.";
      status.className = "form-status success";
      await loadMyAppointments();
      window.setTimeout(closeReviewModal, 900);
    } catch (error) {
      status.textContent = `No pudimos guardar la reseña: ${error.message}`;
      status.className = "form-status error";
    } finally {
      button.disabled = false;
    }
  }

  let currentCalDate = new Date();

  function renderCalendar() {
    const grid = document.getElementById("calendar-grid");
    const monthYear = document.getElementById("cal-month-year");
    if (!grid || !monthYear) return;

    grid.innerHTML = "";
    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    monthYear.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay(); // 0 = Domingo
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement("div");
      empty.className = "cal-day empty";
      grid.appendChild(empty);
    }

    const todayStr = today();
    const inputDate = document.getElementById("book-date");

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("div");
      const cellDateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      
      cell.className = "cal-day";
      cell.textContent = day;

      if (cellDateStr === todayStr) {
        cell.classList.add("today");
      }

      if (cellDateStr < todayStr) {
        cell.classList.add("disabled");
      } else {
        if (selected.date === cellDateStr) {
          cell.classList.add("selected");
        }
        cell.addEventListener("click", () => {
          selected.date = cellDateStr;
          document.querySelectorAll(".cal-day.selected").forEach(el => el.classList.remove("selected"));
          cell.classList.add("selected");
          inputDate.value = cellDateStr;
          inputDate.dispatchEvent(new Event("change"));
        });
      }
      grid.appendChild(cell);
    }
  }

  function changeMonth(offset) {
    currentCalDate.setMonth(currentCalDate.getMonth() + offset);
    renderCalendar();
  }

  function bindEvents() {
    document.getElementById("book-date").addEventListener("change", loadSlots);
    
    const prevBtn = document.getElementById("cal-prev");
    const nextBtn = document.getElementById("cal-next");
    if (prevBtn) prevBtn.addEventListener("click", () => changeMonth(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => changeMonth(1));

    ["book-name", "book-phone"].forEach((id) => {
      document.getElementById(id).addEventListener("input", checkShowSummary);
    });
    document.getElementById("review-modal").addEventListener("click", (event) => {
      if (event.target.id === "review-modal") closeReviewModal();
    });
  }

  async function init() {
    bindEvents();
    renderCalendar();
    document.getElementById("services-list").innerHTML = "<div class='skeleton skeleton-card'></div><div class='skeleton skeleton-card'></div><div class='skeleton skeleton-card'></div>";

    try {
      [professionals, services, prices] = await Promise.all([
        api("professionals", "select=*&is_active=eq.true&order=sort_order"),
        api("services", "select=*&is_active=eq.true&order=sort_order"),
        api("service_professional_prices", "select=*&is_active=eq.true"),
      ]);

      renderServices();
      await Promise.allSettled([bootstrapIdentity(), loadLoyaltySummary()]);
    } catch (error) {
      document.getElementById("services-list").innerHTML = `<p class="hint">No pudimos cargar los servicios: ${escapeHtml(error.message)}</p>`;
    }
  }

  window.logoutClient = function () {
    localStorage.removeItem("vasca_token");
    localStorage.removeItem("vasca_refresh");
    localStorage.removeItem("vasca_user");
    localStorage.removeItem("vasca_role");
    window.location.href = "login.html";
  };

  window.switchTab = switchTab;
  window.confirmBooking = confirmBooking;
  window.submitReview = submitReview;
  window.vasca = {
    selectService,
    selectProfessional,
    selectTime,
    cancelMyAppt,
    openReviewModal,
    closeReviewModal,
    setReviewRating,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
