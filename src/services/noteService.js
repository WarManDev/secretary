import models from '../models/index.js';

/**
 * Создаёт новую заметку.
 * @param {Object} noteData - Объект с данными заметки (например, content).
 * @returns {Promise<Object>} - Созданная заметка.
 */
export async function createNote(noteData) {
  return await models.Note.create(noteData);
}

/**
 * Получает все невыполненные заметки.
 * @returns {Promise<Array>} - Массив заметок, у которых completed = false.
 */
export async function getPendingNotes() {
  return await models.Note.findAll({
    where: { completed: false },
    order: [['created_at', 'ASC']],
  });
}

/**
 * Помечает заметки с указанными ID как выполненные.
 * @param {Array} noteIds - Массив идентификаторов заметок.
 * @returns {Promise<void>}
 */
export async function markNotesCompleted(noteIds) {
  await models.Note.update({ completed: true }, { where: { id: noteIds } });
}
