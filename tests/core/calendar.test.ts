// The naive calendar (PLUGINS.md §7.2): Monday to Friday, hpd hours a day, working hours from the
// project start. These fix what a day and a deadline mean for the scheduler.
// 2026-10-05 is a Monday; 2026-10-09 a Friday; 2026-10-10 a Saturday.

import { describe, expect, it } from 'vitest';
import { naiveCalendar } from '../../src/core';

const monday = naiveCalendar('2026-10-05', 8);

describe('the naive calendar', () => {
  it('starts hour 0 on the project start, at both edges of a day', () => {
    expect(monday.start).toBe('2026-10-05');
    expect(monday.hoursPerDay).toBe(8);
    expect(monday.fromDate('2026-10-05', 'start')).toBe(0);
    expect(monday.fromDate('2026-10-05', 'end')).toBe(8);
    expect(monday.fromDate('2026-10-09', 'start')).toBe(32);
  });

  it('adds across a weekend', () => {
    const friday = monday.fromDate('2026-10-09', 'start');
    const finish = monday.add(friday, 16);
    expect(finish).toBe(48);
    expect(monday.toDate(finish, 'end')).toBe('2026-10-12');
    expect(monday.toDate(monday.add(friday, 12), 'end')).toBe('2026-10-12');
    expect(monday.toDate(monday.add(friday, 8), 'start')).toBe('2026-10-12');
  });

  it('starts a weekend project-start on the Monday after it', () => {
    const saturday = naiveCalendar('2026-10-10', 8);
    expect(saturday.toDate(0, 'start')).toBe('2026-10-12');
    expect(saturday.toDate(saturday.add(0, 8), 'end')).toBe('2026-10-12');
    expect(saturday.fromDate('2026-10-10', 'start')).toBe(0);
    expect(saturday.fromDate('2026-10-12', 'start')).toBe(0);
    expect(saturday.fromDate('2026-10-09', 'end')).toBe(0);
  });

  it('adds negative hours for the backward pass, before the project start too', () => {
    expect(monday.add(48, -16)).toBe(32);
    expect(monday.toDate(monday.add(48, -16), 'start')).toBe('2026-10-09');
    expect(monday.toDate(monday.add(0, -8), 'start')).toBe('2026-10-02');
    expect(monday.fromDate('2026-10-02', 'start')).toBe(-8);
    expect(monday.toDate(monday.add(0, -1), 'end')).toBe('2026-10-02');
  });

  it("converts a weekend day's start to the Monday after, and its end to the Friday before", () => {
    expect(monday.fromDate('2026-10-10', 'start')).toBe(40);
    expect(monday.fromDate('2026-10-11', 'start')).toBe(40);
    expect(monday.fromDate('2026-10-10', 'end')).toBe(40);
    expect(monday.fromDate('2026-10-09', 'end')).toBe(40);
  });

  // Task 38: a milestone pinned to Sat 24 Oct converts to the end of Fri 23 Oct, day 14.
  it("converts a later weekend day's end to the end of the Friday before (Task 38)", () => {
    expect(monday.fromDate('2026-10-24', 'end')).toBe(120);
    expect(monday.fromDate('2026-10-25', 'end')).toBe(120);
    expect(monday.toDate(120, 'end')).toBe('2026-10-23');
  });

  // Task 38: there is no working hour before hour 0, so its end edge is hour 0's own day.
  it("shows hour 0 at the end edge on hour 0's own day (Task 38)", () => {
    expect(monday.toDate(0, 'end')).toBe('2026-10-05');
    expect(monday.toDate(0, 'end')).toBe(monday.toDate(0, 'start'));
    // A weekend project-start: hour 0 is the Monday after it.
    expect(naiveCalendar('2026-10-10', 8).toDate(0, 'end')).toBe('2026-10-12');
  });

  it('does not make a task that finishes at the end of its deadline day late', () => {
    // Deadlines convert at 'end', so a task finishing that day is on time.
    const start = monday.fromDate('2026-10-07', 'start');
    const deadline = monday.fromDate('2026-10-09', 'end');
    expect(monday.add(start, 24) <= deadline).toBe(true);
    expect(monday.add(start, 25) <= deadline).toBe(false);
  });

  it('shows an 8-hour task starting Monday as Monday to Monday', () => {
    const start = monday.fromDate('2026-10-05', 'start');
    const finish = monday.add(start, 8);
    expect(monday.toDate(start, 'start')).toBe('2026-10-05');
    expect(monday.toDate(finish, 'end')).toBe('2026-10-05');
    // A part-day finish belongs to the day it falls in.
    expect(monday.toDate(monday.add(start, 0.5), 'end')).toBe('2026-10-05');
  });

  it('gives 6-hour days with hpd=6', () => {
    const six = naiveCalendar('2026-10-05', 6);
    expect(six.hoursPerDay).toBe(6);
    expect(six.fromDate('2026-10-06', 'start')).toBe(6);
    expect(six.fromDate('2026-10-12', 'start')).toBe(30);
    expect(six.toDate(six.add(0, 6), 'end')).toBe('2026-10-05');
    expect(six.toDate(six.add(0, 7), 'end')).toBe('2026-10-06');
  });

  it('crosses a year end and a leap day', () => {
    const dec = naiveCalendar('2027-12-31', 8); // a Friday
    expect(dec.toDate(8, 'start')).toBe('2028-01-03');
    const feb = naiveCalendar('2028-02-28', 8); // a Monday
    expect(feb.toDate(8, 'start')).toBe('2028-02-29');
    expect(feb.fromDate('2028-03-01', 'start')).toBe(16);
  });
});
