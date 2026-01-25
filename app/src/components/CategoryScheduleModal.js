import React from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Switch, Alert
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' }
];

// Convert 24-hour time to 12-hour format with AM/PM
const formatTime12Hour = (time24) => {
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

export default function CategoryScheduleModal({
  visible,
  category,
  scheduleForm,
  setScheduleForm,
  onSave,
  onClose,
  saving
}) {
  const toggleDay = (day) => {
    setScheduleForm(prev => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter(d => d !== day)
        : [...prev.days, day].sort()
    }));
  };

  const updateTime = (field, hours, minutes, period) => {
    const hours24 = convertTo24Hour(hours, period);
    const timeString = `${hours24}:${minutes}`;
    setScheduleForm(prev => ({ ...prev, [field]: timeString }));
  };

  const incrementHour = (field) => {
    const [hours, minutes] = scheduleForm[field].split(':').map(Number);
    
    // Calculate new hour in 24-hour format
    let newHours24 = hours + 1;
    if (newHours24 >= 24) {
      newHours24 = 0;
    }
    
    // Convert to 12-hour format
    const newPeriod = newHours24 >= 12 ? 'PM' : 'AM';
    const newHours12 = newHours24 % 12 || 12;
    
    updateTime(field, newHours12, minutes.toString().padStart(2, '0'), newPeriod);
  };

  const decrementHour = (field) => {
    const [hours, minutes] = scheduleForm[field].split(':').map(Number);
    
    // Calculate new hour in 24-hour format
    let newHours24 = hours - 1;
    if (newHours24 < 0) {
      newHours24 = 23;
    }
    
    // Convert to 12-hour format
    const newPeriod = newHours24 >= 12 ? 'PM' : 'AM';
    const newHours12 = newHours24 % 12 || 12;
    
    updateTime(field, newHours12, minutes.toString().padStart(2, '0'), newPeriod);
  };

  const togglePeriod = (field) => {
    const [hours, minutes] = scheduleForm[field].split(':').map(Number);
    const currentPeriod = hours >= 12 ? 'PM' : 'AM';
    const newPeriod = currentPeriod === 'AM' ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    
    updateTime(field, hours12, minutes.toString().padStart(2, '0'), newPeriod);
  };

  const validateAndSave = () => {
    // Validate custom days
    if (scheduleForm.type === 'custom' && scheduleForm.days.length === 0) {
      Alert.alert('Validation Error', 'Please select at least one day for custom schedule');
      return;
    }

    // Parse times
    const [startHour, startMin] = scheduleForm.startTime.split(':').map(Number);
    const [endHour, endMin] = scheduleForm.endTime.split(':').map(Number);
    
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    // Check if start and end times are the same
    if (startMinutes === endMinutes) {
      Alert.alert(
        'Invalid Time Range',
        'Start time and end time cannot be the same. Please choose different times.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Allow overnight schedules (end time before start time is valid)
    // No validation error for overnight schedules

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
                  <Text style={styles.switchSubtext}>Auto-pause category outside schedule</Text>
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

                {/* Custom Days Selection */}
                {scheduleForm.type === 'custom' && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Select Days</Text>
                    <View style={styles.daysContainer}>
                      {DAYS.map(day => (
                        <TouchableOpacity
                          key={day.value}
                          style={[
                            styles.dayButton,
                            scheduleForm.days.includes(day.value) && styles.dayButtonActive
                          ]}
                          onPress={() => toggleDay(day.value)}
                        >
                          <Text style={[
                            styles.dayButtonText,
                            scheduleForm.days.includes(day.value) && styles.dayButtonTextActive
                          ]}>
                            {day.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {/* Time Selection */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Available Hours</Text>
                  
                  {/* Start Time */}
                  <View style={styles.timeRow}>
                    <Text style={styles.timeLabel}>From</Text>
                    <View style={styles.timePickers}>
                      <View style={styles.timePicker}>
                        <Text style={styles.timeValue}>{formatTime12Hour(scheduleForm.startTime)}</Text>
                        <View style={styles.timeButtons}>
                          <TouchableOpacity 
                            style={styles.timeButton}
                            onPress={() => incrementHour('startTime')}
                          >
                            <Ionicons name="chevron-up" size={16} color="#6b7280" />
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={styles.timeButton}
                            onPress={() => decrementHour('startTime')}
                          >
                            <Ionicons name="chevron-down" size={16} color="#6b7280" />
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity 
                          style={styles.periodButton}
                          onPress={() => togglePeriod('startTime')}
                        >
                          <Ionicons name="swap-horizontal" size={16} color="#E23744" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  {/* End Time */}
                  <View style={styles.timeRow}>
                    <Text style={styles.timeLabel}>To</Text>
                    <View style={styles.timePickers}>
                      <View style={styles.timePicker}>
                        <Text style={styles.timeValue}>{formatTime12Hour(scheduleForm.endTime)}</Text>
                        <View style={styles.timeButtons}>
                          <TouchableOpacity 
                            style={styles.timeButton}
                            onPress={() => incrementHour('endTime')}
                          >
                            <Ionicons name="chevron-up" size={16} color="#6b7280" />
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={styles.timeButton}
                            onPress={() => decrementHour('endTime')}
                          >
                            <Ionicons name="chevron-down" size={16} color="#6b7280" />
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity 
                          style={styles.periodButton}
                          onPress={() => togglePeriod('endTime')}
                        >
                          <Ionicons name="swap-horizontal" size={16} color="#E23744" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  <Text style={styles.timeHint}>
                    Category will be available from {formatTime12Hour(scheduleForm.startTime)} to {formatTime12Hour(scheduleForm.endTime)}
                    {scheduleForm.type === 'custom' && scheduleForm.days.length > 0 && 
                      ` on ${scheduleForm.days.map(d => DAYS[d].label).join(', ')}`}
                  </Text>
                </View>
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
    marginBottom: 12,
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
  daysContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayButtonActive: {
    borderColor: '#E23744',
    backgroundColor: '#E23744',
  },
  dayButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  dayButtonTextActive: {
    color: '#fff',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  timeLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    width: 60,
  },
  timePickers: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  timePicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  timeValue: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  timeButtons: {
    gap: 4,
    marginRight: 8,
  },
  timeButton: {
    padding: 4,
  },
  periodButton: {
    padding: 6,
    backgroundColor: '#fee2e2',
    borderRadius: 8,
  },
  timeHint: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 8,
    lineHeight: 18,
  },
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
