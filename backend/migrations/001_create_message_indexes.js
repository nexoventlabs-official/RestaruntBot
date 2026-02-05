/**
 * Migration: Create indexes for InboundMessage and OutboundMessage
 * Created: 2026-02-05
 * 
 * Purpose: Create basic indexes for message collections
 */

module.exports = {
  async up(db, client) {
    console.log('🔄 Creating message collection indexes...');
    
    try {
      // InboundMessages collection indexes
      await db.collection('inboundmessages').createIndex(
        { messageId: 1 },
        { unique: true, name: 'messageId_unique' }
      );
      console.log('✅ Created messageId_unique index');
    } catch (error) {
      if (error.code === 85 || error.message.includes('already exists')) {
        console.log('⏭️ messageId_unique index already exists, skipping');
      } else {
        throw error;
      }
    }
    
    try {
      await db.collection('inboundmessages').createIndex(
        { from: 1, timestamp: -1 },
        { name: 'from_timestamp' }
      );
      console.log('✅ Created from_timestamp index');
    } catch (error) {
      if (error.code === 85 || error.message.includes('already exists')) {
        console.log('⏭️ from_timestamp index already exists, skipping');
      } else {
        throw error;
      }
    }
    
    try {
      await db.collection('inboundmessages').createIndex(
        { status: 1 },
        { name: 'inbound_status' }
      );
      console.log('✅ Created inbound_status index');
    } catch (error) {
      if (error.code === 85 || error.message.includes('already exists')) {
        console.log('⏭️ inbound_status index already exists, skipping');
      } else {
        throw error;
      }
    }
    
    // OutboundMessages collection indexes
    try {
      await db.collection('outboundmessages').createIndex(
        { to: 1, timestamp: -1 },
        { name: 'to_timestamp' }
      );
      console.log('✅ Created to_timestamp index');
    } catch (error) {
      if (error.code === 85 || error.message.includes('already exists')) {
        console.log('⏭️ to_timestamp index already exists, skipping');
      } else {
        throw error;
      }
    }
    
    try {
      await db.collection('outboundmessages').createIndex(
        { status: 1 },
        { name: 'outbound_status' }
      );
      console.log('✅ Created outbound_status index');
    } catch (error) {
      if (error.code === 85 || error.message.includes('already exists')) {
        console.log('⏭️ outbound_status index already exists, skipping');
      } else {
        throw error;
      }
    }
    
    console.log('✅ Message indexes migration complete');
  },

  async down(db, client) {
    console.log('🔄 Removing message indexes...');
    
    try {
      await db.collection('inboundmessages').dropIndex('messageId_unique');
    } catch (error) {
      console.log('⏭️ messageId_unique index not found, skipping');
    }
    
    try {
      await db.collection('inboundmessages').dropIndex('from_timestamp');
    } catch (error) {
      console.log('⏭️ from_timestamp index not found, skipping');
    }
    
    try {
      await db.collection('inboundmessages').dropIndex('inbound_status');
    } catch (error) {
      console.log('⏭️ inbound_status index not found, skipping');
    }
    
    try {
      await db.collection('outboundmessages').dropIndex('to_timestamp');
    } catch (error) {
      console.log('⏭️ to_timestamp index not found, skipping');
    }
    
    try {
      await db.collection('outboundmessages').dropIndex('outbound_status');
    } catch (error) {
      console.log('⏭️ outbound_status index not found, skipping');
    }
    
    console.log('✅ Message indexes removed successfully');
  }
};
