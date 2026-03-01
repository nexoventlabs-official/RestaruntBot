/**
 * List of Indian States and Union Territories
 * Used for Delivery Address form dropdown in WhatsApp Flows.
 * Format: { id, title } for WhatsApp Flow Dropdown data-source compatibility.
 */
const indianStates = [
  { id: 'andhra_pradesh', title: 'Andhra Pradesh' },
  { id: 'arunachal_pradesh', title: 'Arunachal Pradesh' },
  { id: 'assam', title: 'Assam' },
  { id: 'bihar', title: 'Bihar' },
  { id: 'chhattisgarh', title: 'Chhattisgarh' },
  { id: 'goa', title: 'Goa' },
  { id: 'gujarat', title: 'Gujarat' },
  { id: 'haryana', title: 'Haryana' },
  { id: 'himachal_pradesh', title: 'Himachal Pradesh' },
  { id: 'jharkhand', title: 'Jharkhand' },
  { id: 'karnataka', title: 'Karnataka' },
  { id: 'kerala', title: 'Kerala' },
  { id: 'madhya_pradesh', title: 'Madhya Pradesh' },
  { id: 'maharashtra', title: 'Maharashtra' },
  { id: 'manipur', title: 'Manipur' },
  { id: 'meghalaya', title: 'Meghalaya' },
  { id: 'mizoram', title: 'Mizoram' },
  { id: 'nagaland', title: 'Nagaland' },
  { id: 'odisha', title: 'Odisha' },
  { id: 'punjab', title: 'Punjab' },
  { id: 'rajasthan', title: 'Rajasthan' },
  { id: 'sikkim', title: 'Sikkim' },
  { id: 'tamil_nadu', title: 'Tamil Nadu' },
  { id: 'telangana', title: 'Telangana' },
  { id: 'tripura', title: 'Tripura' },
  { id: 'uttar_pradesh', title: 'Uttar Pradesh' },
  { id: 'uttarakhand', title: 'Uttarakhand' },
  { id: 'west_bengal', title: 'West Bengal' },
  { id: 'andaman_nicobar', title: 'Andaman & Nicobar Islands' },
  { id: 'chandigarh', title: 'Chandigarh' },
  { id: 'dadra_nagar_haveli', title: 'Dadra & Nagar Haveli and Daman & Diu' },
  { id: 'delhi', title: 'Delhi' },
  { id: 'jammu_kashmir', title: 'Jammu & Kashmir' },
  { id: 'ladakh', title: 'Ladakh' },
  { id: 'lakshadweep', title: 'Lakshadweep' },
  { id: 'puducherry', title: 'Puducherry' }
];

/**
 * Get state title from state id
 * @param {string} stateId - e.g. 'andhra_pradesh'
 * @returns {string|null} e.g. 'Andhra Pradesh'
 */
function getStateName(stateId) {
  const state = indianStates.find(s => s.id === stateId);
  return state ? state.title : null;
}

/**
 * Find state by name (case-insensitive, partial match)
 * @param {string} name - e.g. 'andhra' or 'Andhra Pradesh'
 * @returns {object|null} { id, title }
 */
function findStateByName(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  // Exact match first
  const exact = indianStates.find(s => s.title.toLowerCase() === lower);
  if (exact) return exact;
  // Partial match
  return indianStates.find(s => s.title.toLowerCase().includes(lower)) || null;
}

module.exports = { indianStates, getStateName, findStateByName };
