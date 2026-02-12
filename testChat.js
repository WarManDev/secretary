async function testEventCreation() {
  let date = "завтра"; // или полученное значение от ChatGPT
  const time = "15:00";
  const participants = ["Иван"];

  // Преобразование "завтра" в конкретную дату:
  const eventDate = date === "завтра"
    ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    : date;

  console.log("Используемая дата для события:", eventDate);
  console.log("Начало события:", `${eventDate}T${time}:00`);
  console.log("Окончание события:", computeEndDateTime(eventDate, time));

  const eventDetails = {
    summary: `Встреча с ${participants.join(", ")}`,
    description: "Встреча, созданная автоматически через ассистента.",
    start: {
      dateTime: `${eventDate}T${time}:00`,
      timeZone: "Europe/Moscow",
    },
    end: {
      dateTime: computeEndDateTime(eventDate, time),
      timeZone: "Europe/Moscow",
    },
  };

  try {
    const createdEvent = await createEvent(eventDetails);
    console.log("Событие создано:", createdEvent);
  } catch (error) {
    console.error("Ошибка создания события:", error);
  }
}

testEventCreation();

