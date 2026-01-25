import React from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Switch
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

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

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

  const updateTime = (field, value) => {
    setScheduleForm(prev => ({ ...prev, [field]: value }));
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
                        <Text style={styles.timeValue}>{scheduleForm.startTime}</Text>
                        <View style={styles.timeButtons}>
                          <TouchableOpacity 
                            style={styles.timeButton}
                            onPress={() => {
                              const [h, m] = scheduleForm.startTime.split(':');
                              const newH = (parseInt(h) + 1) % 24;
                              updateTime('startTime', `${newH.toString().padStart(2, '0')}:${m}`);
                            }}
                          >
                            <Ionicons name="chevron-up" size={16} color="#6b7280" />
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={styles.timeButton}
                            onPress={() => {
                              const [h, m] = scheduleForm.startTime.split(':');
                              const newH = (parseInt(h) - 1 + 24) % 24;
                              updateTime('startTime', `${newH.toString().padStart(2, '0')}:${m}`);
                            }}
                          >
                            <Ionicons name="chevron-down" size={16} color="#6b7280" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* End Time */}
                  <View style={styles.timeRow}>
                    <Text style={styles.timeLabel}>To</Text>
                    <View style={styles.timePickers}>
                      <View style={styles.timePicker}>
                        <Text style={styles.timeValue}>{scheduleForm.endTime}</Text>
                        <View style={styles.timeButtons}>
                          <TouchableOpacity 
                            style={styles.timeButton}
                            onPress={() => {
                              const [h, m] = scheduleForm.endTime.split(':');
                              const newH = (parseInt(h) + 1) % 24;
                              updateTime('endTime', `${newH.toString().padStart(2, '0')}:${m}`);
                            }}
                          >
                            <Ionicons name="chevron-up" size={16} color="#6b7280" />
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={styles.timeButton}
                            onPress={() => {
                              const [h, m] = scheduleForm.endTime.split(':');
                              const newH = (parseInt(h) - 1 + 24) % 24;
                              updateTime('endTime', `${newH.toString().padStart(2, '0')}:${m}`);
                            }}
                          >
                            <Ionicons name="chevron-down" size={16} color="#6b7280" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </View>

                  <Text style={styles.timeHint}>
                    Category will be available from {scheduleForm.startTime} to {scheduleForm.endTime}
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
              onPress={onSave}
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
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  timeButtons: {
    gap: 4,
  },
  timeButton: {
    padding: 4,
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
