import { describe, expect, it, vi } from 'vitest';
import { CompanyCalendarService } from './company-calendar.service';
import { ReportConfigurationService } from '../report-configuration/report-configuration.service';
const valid={timezone:'Europe/Kyiv',workingDays:[1,2,3,4,5],workStart:'09:00',workEnd:'18:00'};
function setup(){
 const saveCalendar=vi.fn().mockResolvedValue({calendar:valid,configuration:{revision:2}});
 const recalculator={recalculateScheduledReminders:vi.fn().mockResolvedValue(undefined)};
 const service=new CompanyCalendarService({client:{select:()=>({from:()=>({where:async()=>[]})})}} as never,recalculator,{saveCalendar} as unknown as ReportConfigurationService);
 return {service,saveCalendar,recalculator};
}
describe('CompanyCalendarService',()=>{
 it('retains the legacy base reader projection',async()=>expect(await setup().service.get('tenant')).toBeNull());
 it('requires an operator',async()=>await expect(setup().service.configure('tenant',valid,'',1)).rejects.toMatchObject({code:'operator_required'}));
 it('delegates atomic config save with explicit CAS before reminder recalculation',async()=>{
  const {service,saveCalendar,recalculator}=setup();
  expect(await service.configure('tenant',valid,'op',1)).toMatchObject({calendar:valid,recalculation:'queued'});
  expect(saveCalendar).toHaveBeenCalledWith('tenant',valid,'op',1);
  expect(recalculator.recalculateScheduledReminders).toHaveBeenCalledWith('tenant');
 });
 it('never recalculates when save fails',async()=>{
  const {service,saveCalendar,recalculator}=setup();saveCalendar.mockRejectedValueOnce(new Error('stale'));
  await expect(service.configure('tenant',valid,'op',1)).rejects.toThrow('stale');expect(recalculator.recalculateScheduledReminders).not.toHaveBeenCalled();
 });
 it('retries recalculation even after an identical save; a queue failure cannot roll back committed settings',async()=>{
  const {service,recalculator}=setup();recalculator.recalculateScheduledReminders.mockRejectedValueOnce(new Error('queue down'));
  expect(await service.configure('tenant',valid,'op',1)).toMatchObject({recalculation:'failed'});
  expect(await service.configure('tenant',valid,'op',2)).toMatchObject({recalculation:'queued'});
 });
});
