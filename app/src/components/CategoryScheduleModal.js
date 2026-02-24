import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Switch, Alert, Platform
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

const ZOMATO_RED = '#E23744';

const DAYS = [
  { value: 0, label: 'Sun', fullLabel: 'Sunday' },
  { value: 1, label: 'Mon', fullLabel: 'Monday' },
  { value: 2, label: 'Tue', fullLabel: 'Tuesday' },
  { value: 3, label: 'Wed', fullLabel: 'Wednesday' },
  { value: 4, label: 'Thu', fullLabel: 'Thursday' },
  { value: 5, label: 'Fri', fullLabel: 'Friday' },
  { value: 6, label: 'Sat', fullLabel: 'Saturday' }
];

// Convert 24-hour time to 12-hour format with AM/PM
const formatTime12Hour = (time24) => {
  if (!time24) return '12:00 AM';
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
};

// Convert 12-hour time to 24-hour format
const convertTo24Hour = (hours12, period) => {
  let hours = parseInt(hours12);
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours.toString().padStart(2, '0');
};

// Time Picker Component for individual day
const DayTimePicker = ({ day, daySchedule, onUpdate, defaultStartTime, defaultEndTime, onOpenTimePicker }) => {
  const startTime = daySchedule?.startTime || defaultStartTime || '09:00';
  const endTime = daySchedule?.endTime || defaultEndTime || '22:00';
  const enabled = daySchedule?.enabled !== false;

  const toggleDayEnabled = () => {
    onUpdate(day.value, { 
      day: day.value,
      enabled: !enabled,
      startTime: startTime,
      endTime: endTime
    });
  };

  return (
    <View style={[styles.dayCard, !enabled && styles.dayCardDisabled]}>
      <View style={styles.dayCardHeader}>
        <TouchableOpacity 
          style={[styles.dayToggle, enabled && styles.dayToggleActive]}
          onPress={toggleDayEnabled}
        >
          <Ionicons 
            name={enabled ? "checkmark-circle" : "ellipse-outline"} 
            size={24} 
            color={enabled ? "#22c55e" : "#d1d5db"} 
          />
          <Text style={[styles.dayToggleText, enabled && styles.dayToggleTextActive]}>
            {day.fullLabel}
          </Text>
        </TouchableOpacity>
        {enabled && (
          <Text style={styles.dayTimePreview}>
            {formatTime12Hour(startTime)} - {formatTime12Hour(endTime)}
          </Text>
        )}
      </View>
      {enabled && (
        <View style={styles.dayCardBody}>
          <View style={styles.miniTimeRow}>
            <Text style={styles.miniTimeLabel}>From</Text>
            <TouchableOpacity
              onPress={() => onOpenTimePicker('customStartTime', day.value)}
              style={styles.nativeTimePickerButton}
            >
              <Ionicons name="time-outline" size={18} color={ZOMATO_RED} />
              <Text style={styles.nativeTimePickerText}>{formatTime12Hour(startTime)}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.miniTimeRow}>
            <Text style={styles.miniTimeLabel}>To</Text>
            <TouchableOpacity
              onPress={() => onOpenTimePicker('customEndTime', day.value)}
              style={styles.nativeTimePickerButton}
            >
              <Ionicons name="time-outline" size={18} color={ZOMATO_RED} />
              <Text style={styles.nativeTimePickerText}>{formatTime12Hour(endTime)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

export default function CategoryScheduleModal({
  visible,
  category,
  scheduleForm,
  setScheduleForm,
  onSave,
  onClose,
  saving
}) {
  // Initialize customDays if not present
  useEffect(() => {
    if (scheduleForm.type === 'custom' && (!scheduleForm.customDays || scheduleForm.customDays.length === 0)) {
      // Initialize with default times for backward compatibility
      const defaultCustomDays = scheduleForm.days?.map(day => ({
        day,
        enabled: true,
        startTime: scheduleForm.startTime || '09:00',
        endTime: scheduleForm.endTime || '22:00'
      })) || [];
      setScheduleForm(prev => ({ ...prev, customDays: defaultCustomDays }));
    }
  }, [scheduleForm.type]);

  const updateDaySchedule = (dayValue, daySchedule) => {
    setScheduleForm(prev => {
      const existingIndex = prev.customDays?.findIndex(d => d.day === dayValue) ?? -1;
      let newCustomDays;
      
      if (existingIndex >= 0) {
        newCustomDays = [...(prev.customDays || [])];
        newCustomDays[existingIndex] = daySchedule;
      } else {
        newCustomDays = [...(prev.customDays || []), daySchedule];
      }
      
      // Also update days array for backward compatibility
      const enabledDays = newCustomDays.filter(d => d.enabled).map(d => d.day).sort();
      
      return { 
        ...prev, 
        customDays: newCustomDays,
        days: enabledDays
      };
    });
  };

  const getDaySchedule = (dayValue) => {
    return scheduleForm.customDays?.find(d => d.day === dayValue) || {
      day: dayValue,
      enabled: false,
      startTime: scheduleForm.startTime || '09:00',
      endTime: scheduleForm.endTime || '22:00'
    };
  };

  // ─── Native Time Picker State ───
  const [nativeTimePicker, setNativeTimePicker] = useState({ visible: false, field: '', dayValue: null });

  const timeStringToDate = (timeStr) => {
    const [h, m] = (timeStr || '09:00').split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };

  const openNativeTimePicker = (field, dayValue = null) => {
    setNativeTimePicker({ visible: true, field, dayValue });
  };

  const onNativeTimeChange = (event, selectedDate) => {
    setNativeTimePicker(prev => ({ ...prev, visible: Platform.OS === 'ios' }));
    if (event.type === 'dismissed' || !selectedDate) return;
    const h = selectedDate.getHours().toString().padStart(2, '0');
    const m = selectedDate.getMinutes().toString().padStart(2, '0');
    const timeStr = `${h}:${m}`;

    const { field, dayValue } = nativeTimePicker;
    if (field === 'startTime' || field === 'endTime') {
      setScheduleForm(prev => ({ ...prev, [field]: timeStr }));
    } else if (field === 'customStartTime' || field === 'customEndTime') {
      const actualField = field === 'customStartTime' ? 'startTime' : 'endTime';
      const daySchedule = getDaySchedule(dayValue);
      updateDaySchedule(dayValue, {
        ...daySchedule,
        day: dayValue,
        enabled: true,
        [actualField]: timeStr,
      });
    }
  };

  const getNativeTimePickerValue = () => {
    const { field, dayValue } = nativeTimePicker;
    if (field === 'startTime' || field === 'endTime') {
      return timeStringToDate(scheduleForm[field]);
    } else if (field === 'customStartTime' || field === 'customEndTime') {
      const actualField = field === 'customStartTime' ? 'startTime' : 'endTime';
      const daySchedule = getDaySchedule(dayValue);
      return timeStringToDate(daySchedule[actualField]);
    }
    return new Date();
  };

  const validateAndSave = () => {
    if (scheduleForm.type === 'custom') {
      // Validate custom days - at least one day must be enabled
      const enabledDays = scheduleForm.customDays?.filter(d => d.enabled) || [];
      if (enabledDays.length === 0) {
        Alert.alert('Validation Error', 'Please enable at least one day for custom schedule');
        return;
      }
      
      // Validate each enabled day has valid times
      for (const daySchedule of enabledDays) {
        const [startHour, startMin] = daySchedule.startTime.split(':').map(Number);
        const [endHour, endMin] = daySchedule.endTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        const dayName = DAYS.find(d => d.value === daySchedule.day)?.fullLabel;
        
        if (startMinutes === endMinutes) {
          Alert.alert('Invalid Time Range', `Start and end time cannot be the same for ${dayName}`);
          return;
        }
        
        // Check if end time is before start time (and not an overnight schedule)
        // Allow overnight only if there's at least 1 hour difference
        if (endMinutes < startMinutes && (startMinutes - endMinutes) < 60) {
          Alert.alert(
            'Invalid Time Range', 
            `End time (${formatTime12Hour(daySchedule.endTime)}) cannot be before start time (${formatTime12Hour(daySchedule.startTime)}) for ${dayName}.\n\nIf you want an overnight schedule, make sure there's at least 1 hour gap.`
          );
          return;
        }
        
        // For same-day schedules (end > start), ensure at least 15 min difference
        if (endMinutes > startMinutes && (endMinutes - startMinutes) < 15) {
          Alert.alert(
            'Invalid Time Range', 
            `Schedule must be at least 15 minutes long for ${dayName}`
          );
          return;
        }
      }
    } else {
      // Validate daily schedule
      const [startHour, startMin] = scheduleForm.startTime.split(':').map(Number);
      const [endHour, endMin] = scheduleForm.endTime.split(':').map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      if (startMinutes === endMinutes) {
        Alert.alert('Invalid Time Range', 'Start time and end time cannot be the same.');
        return;
      }
      
      // Check if end time is before start time (and not an overnight schedule)
      if (endMinutes < startMinutes && (startMinutes - endMinutes) < 60) {
        Alert.alert(
          'Invalid Time Range', 
          `End time (${formatTime12Hour(scheduleForm.endTime)}) cannot be before start time (${formatTime12Hour(scheduleForm.startTime)}).\n\nIf you want an overnight schedule, make sure there's at least 1 hour gap.`
        );
        return;
      }
      
      // For same-day schedules, ensure at least 15 min difference
      if (endMinutes > startMinutes && (endMinutes - startMinutes) < 15) {
        Alert.alert('Invalid Time Range', 'Schedule must be at least 15 minutes long.');
        return;
      }
    }

    onSave();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Schedule: {category?.name}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
            {/* Enable Schedule */}
            <View style={styles.section}>
              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.switchLabel}>Enable Schedule</Text>
                  <Text style={styles.switchSubtext}>Auto-lock category outside schedule</Text>
                </View>
                <Switch
                  value={scheduleForm.enabled}
                  onValueChange={(value) => setScheduleForm(prev => ({ ...prev, enabled: value }))}
                  trackColor={{ false: '#d1d5db', true: '#86efac' }}
                  thumbColor={scheduleForm.enabled ? '#22c55e' : '#f3f4f6'}
                />
              </View>
            </View>

            {scheduleForm.enabled && (
              <>
                {/* Schedule Type */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Schedule Type</Text>
                  <View style={styles.typeButtons}>
                    <TouchableOpacity
                      style={[styles.typeButton, scheduleForm.type === 'daily' && styles.typeButtonActive]}
                      onPress={() => setScheduleForm(prev => ({ ...prev, type: 'daily' }))}
                    >
                      <Ionicons 
                        name="calendar" 
                        size={20} 
                        color={scheduleForm.type === 'daily' ? '#fff' : '#6b7280'} 
                      />
                      <Text style={[styles.typeButtonText, scheduleForm.type === 'daily' && styles.typeButtonTextActive]}>
                        Every Day
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.typeButton, scheduleForm.type === 'custom' && styles.typeButtonActive]}
                      onPress={() => setScheduleForm(prev => ({ ...prev, type: 'custom' }))}
                    >
                      <Ionicons 
                        name="calendar-outline" 
                        size={20} 
                        color={scheduleForm.type === 'custom' ? '#fff' : '#6b7280'} 
                      />
                      <Text style={[styles.typeButtonText, scheduleForm.type === 'custom' && styles.typeButtonTextActive]}>
                        Custom Days
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Daily Time Selection */}
                {scheduleForm.type === 'daily' && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Available Hours (Every Day)</Text>
                    
                    {/* Start Time */}
                    <View style={styles.timeRow}>
                      <Text style={styles.timeLabel}>From</Text>
                      <TouchableOpacity
                        onPress={() => openNativeTimePicker('startTime')}
                        style={styles.nativeTimePickerButton}
                      >
                        <Ionicons name="time-outline" size={20} color={ZOMATO_RED} />
                        <Text style={styles.nativeTimePickerText}>{formatTime12Hour(scheduleForm.startTime)}</Text>
                      </TouchableOpacity>
                    </View>

                    {/* End Time */}
                    <View style={styles.timeRow}>
                      <Text style={styles.timeLabel}>To</Text>
                      <TouchableOpacity
                        onPress={() => openNativeTimePicker('endTime')}
                        style={styles.nativeTimePickerButton}
                      >
                        <Ionicons name="time-outline" size={20} color={ZOMATO_RED} />
                        <Text style={styles.nativeTimePickerText}>{formatTime12Hour(scheduleForm.endTime)}</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.timeHint}>
                      Category will be available from {formatTime12Hour(scheduleForm.startTime)} to {formatTime12Hour(scheduleForm.endTime)} every day
                    </Text>
                  </View>
                )}

                {/* Custom Days Selection with Individual Times */}
                {scheduleForm.type === 'custom' && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Set Schedule for Each Day</Text>
                    <Text style={styles.sectionSubtitle}>
                      Enable days and set different times for each
                    </Text>
                    
                    {DAYS.map(day => (
                      <DayTimePicker
                        key={day.value}
                        day={day}
                        daySchedule={getDaySchedule(day.value)}
                        onUpdate={updateDaySchedule}
                        defaultStartTime={scheduleForm.startTime}
                        defaultEndTime={scheduleForm.endTime}
                        onOpenTimePicker={openNativeTimePicker}
                      />
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              disabled={saving}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={validateAndSave}
              disabled={saving}
            >
              <LinearGradient
                colors={['#E23744', '#CB1A27']}
                style={styles.saveButtonGradient}
              >
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : 'Save Schedule'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Native Time Picker */}
      {nativeTimePicker.visible && (
        <DateTimePicker
          value={getNativeTimePickerValue()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onNativeTimeChange}
          is24Hour={false}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  closeButton: {
    padding: 4,
  },
  modalBody: {
    padding: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 16,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  switchSubtext: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  typeButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  typeButtonActive: {
    borderColor: '#E23744',
    backgroundColor: '#E23744',
  },
  typeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6b7280',
  },
  typeButtonTextActive: {
    color: '#fff',
  },
  
  // Daily Time Selection
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  timeLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    width: 60,
  },
  nativeTimePickerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 140,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  nativeTimePickerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
  },
  timeHint: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 8,
    lineHeight: 18,
  },

  // Custom Day Cards
  dayCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    marginBottom: 12,
    overflow: 'hidden',
  },
  dayCardDisabled: {
    backgroundColor: '#f9fafb',
    borderColor: '#f3f4f6',
  },
  dayCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  dayToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dayToggleActive: {},
  dayToggleText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
  },
  dayToggleTextActive: {
    color: '#111827',
  },
  dayTimePreview: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  dayCardBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 12,
  },

  // Mini Time Pickers for each day
  miniTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  miniTimeLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
    width: 45,
  },
  textDisabled: {
    color: '#d1d5db',
  },

  // Footer
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
  saveButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonGradient: {
    padding: 16,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
