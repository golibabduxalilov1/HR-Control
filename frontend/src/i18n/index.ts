import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { uz } from './uz'

// Keys are the Russian UI strings themselves; ru needs no resources (key is returned as-is).
const ru: Record<string, string> = {
  'nav.dashboard': 'Главная', 'nav.today': 'Сегодня', 'nav.structure': 'Структура', 'nav.employees': 'Сотрудники', 'nav.schedules': 'Графики',
  'nav.timesheet': 'Табель', 'nav.payroll': 'Расчёты', 'nav.tasks': 'Задачи', 'nav.notifications': 'Уведомления', 'nav.settings': 'Настройки', 'nav.logout': 'Выход',
  'common.total': 'Всего',
  'login.title': 'Вход в кабинет', 'login.username': 'Логин', 'login.password': 'Пароль', 'login.submit': 'Войти', 'login.project': 'Компания (slug)',
  'status.on_time': 'Вовремя', 'status.late': 'Опоздание', 'status.early_leave': 'Ран. уход', 'status.late_early': 'Опозд. + ран. уход', 'status.absent': 'Отсутствует',
  'status.excused': 'Уваж. причина', 'status.remote': 'Удалённо', 'status.worked_off': 'Отработано', 'status.leave': 'Отпуск', 'status.dismissed': 'Уволен',
  'status.day_off': 'Выходной', 'status.holiday': 'Праздник', 'status.planned': 'Запланировано', 'status.not_hired': '—', 'status.active': 'Активный',
  'status.pending': 'Ожидает', 'status.approved': 'Принято', 'status.rejected': 'Отклонено', 'status.accepted': 'Принята', 'status.review': 'На проверке',
  'dashboard.finance': 'Финансы', 'dashboard.attendance': 'Посещаемость', 'dashboard.totalEmployees': 'Всего сотрудников', 'dashboard.present': 'Присутствуют',
  'dashboard.late': 'Опоздали', 'dashboard.absent': 'Отсутствуют', 'dashboard.remote': 'Удалённо', 'dashboard.resultToday': 'Результат сегодня', 'dashboard.onTime': 'Вовремя',
  'dashboard.byDepartment': 'По отделам', 'dashboard.avgAttendance': 'Средняя посещаемость', 'dashboard.distribution': 'Распределение', 'dashboard.lastPasses': 'Последние проходы',
  'dashboard.showAll': 'Показать все', 'dashboard.atWork': 'Сейчас на работе', 'dashboard.problematic': 'Проблемные сотрудники', 'dashboard.perMonth': 'за месяц',
  'dashboard.allGood': 'Все сотрудники в порядке', 'dashboard.hoursWorked': 'Отработанные часы', 'dashboard.payrollFund': 'Фонд зарплаты', 'dashboard.accrualFund': 'Фонд начислений',
  'dashboard.paymentsDynamics': 'Динамика выплат', 'dashboard.quickActions': 'Быстрые действия', 'dashboard.accrueSalary': 'Начислить зарплату', 'dashboard.addBonus': 'Добавить бонус',
  'dashboard.addFine': 'Добавить штраф', 'dashboard.report': 'Сформировать отчёт', 'dashboard.lastOps': 'Последние операции', 'dashboard.byDep': 'Сотрудники по отделам',
  'dashboard.birthdays': 'Ближайшие дни рождения', 'dashboard.attended': 'Присутствовали', 'dashboard.trend': 'Динамика посещаемости',
}

i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, uz: { translation: { ...Object.fromEntries(Object.entries(ru).map(([k, v]) => [k, uz[v] ?? v])), ...uz } } },
  lng: localStorage.getItem('faceid-lang') || 'ru',
  fallbackLng: 'ru',
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnEmptyString: false,
})

/** Global translator: keys are Russian strings, so `t('Сохранить')` returns itself in ru and the Uzbek text in uz. */
export const tr = (key: string, vars?: Record<string, unknown>) => String(i18n.t(key, (vars ?? {}) as Record<string, string>))

export default i18n
