function toTime(value) {
  if (!value) return Number.POSITIVE_INFINITY
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

export function getPeriodKey(period) {
  if (!period) return ''
  return `${period.start || period.period_start || ''}__${period.end || period.period_end || ''}`
}

export function sortPeriods(periods = []) {
  return [...periods].sort((left, right) => {
    return (
      toTime(left.due || left.dueDate) - toTime(right.due || right.dueDate) ||
      toTime(left.start || left.periodStartDate || left.period_start) -
        toTime(right.start || right.periodStartDate || right.period_start) ||
      toTime(left.end || left.periodEndDate || left.period_end) -
        toTime(right.end || right.periodEndDate || right.period_end)
    )
  })
}

export function getNextOpenPeriod(periods = []) {
  return sortPeriods(periods.filter((period) => period.status === 'open'))[0] || null
}

export function getQuarterLabel(period, allPeriods = []) {
  if (!period) return 'Current quarter'

  const periodKey = getPeriodKey(period)
  const sortedUniquePeriods = sortPeriods(allPeriods).filter((item, index, items) => {
    return items.findIndex((candidate) => getPeriodKey(candidate) === getPeriodKey(item)) === index
  })

  const quarterIndex = sortedUniquePeriods.findIndex((item) => getPeriodKey(item) === periodKey)

  if (quarterIndex >= 0) {
    return `Quarter ${quarterIndex + 1}`
  }

  return 'Current quarter'
}
